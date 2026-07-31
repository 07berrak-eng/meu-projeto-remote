from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import logging
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
import socketio
from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("atlas")

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = "HS256"

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ---------------------------------------------------------------------------
# Password / JWT helpers
# ---------------------------------------------------------------------------

def hash_password(senha: str) -> str:
    return bcrypt.hashpw(senha.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(senha: str, senha_hash: str) -> bool:
    try:
        return bcrypt.checkpw(senha.encode("utf-8"), senha_hash.encode("utf-8"))
    except Exception:
        return False


def criar_token(email: str) -> str:
    payload = {
        "sub": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decodificar_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


async def utilizador_atual(authorization: str = Header(default="")) -> dict:
    token = authorization[7:] if authorization.startswith("Bearer ") else authorization
    email = decodificar_token(token)
    if not email:
        raise HTTPException(status_code=401, detail="Sessao invalida. Inicie sessao novamente.")
    user = await db.utilizadores.find_one({"email": email}, {"_id": 0, "senha_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Utilizador nao encontrado.")
    return user


async def admin_atual(user: dict = Depends(utilizador_atual)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Apenas o administrador pode gerir contas.")
    return user


def limpar_sessao(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


# ---------------------------------------------------------------------------
# FastAPI app + REST routes
# ---------------------------------------------------------------------------

fastapi_app = FastAPI(title="Suporte Tecnico Atlas")
api = APIRouter(prefix="/api")


class LoginIn(BaseModel):
    email: str
    password: str


class SenhaIn(BaseModel):
    atual: str
    nova: str


class RenomearIn(BaseModel):
    nome: str


class NovoUtilizadorIn(BaseModel):
    email: str
    password: str


class EncaminharIn(BaseModel):
    sessaoId: str
    para: str


@api.get("/")
async def root():
    return {"app": "Suporte Tecnico Atlas", "ok": True}


@api.get("/ice")
async def ice_config():
    servers = []
    stun = [u.strip() for u in os.environ.get("STUN_URLS", "").split(",") if u.strip()]
    if stun:
        servers.append({"urls": stun})
    turn_urls = [u.strip() for u in os.environ.get("TURN_URLS", "").split(",") if u.strip()]
    turn_user = os.environ.get("TURN_USERNAME", "")
    turn_cred = os.environ.get("TURN_CREDENTIAL", "")
    if turn_urls and turn_user:
        servers.append({"urls": turn_urls, "username": turn_user, "credential": turn_cred})
    if not servers:
        servers.append({"urls": ["stun:stun.l.google.com:19302"]})
    return {"iceServers": servers}


@api.post("/auth/login")
async def login(dados: LoginIn):
    email = dados.email.strip().lower()
    user = await db.utilizadores.find_one({"email": email})
    if not user or not verify_password(dados.password, user["senha_hash"]):
        raise HTTPException(status_code=401, detail="Email ou palavra-passe incorretos.")
    return {"token": criar_token(email), "email": email, "linkId": user["linkId"], "role": user.get("role", "tecnico")}


@api.get("/auth/me")
async def me(user: dict = Depends(utilizador_atual)):
    return {"email": user["email"], "linkId": user["linkId"], "role": user.get("role", "tecnico")}


@api.get("/app-config")
async def app_config():
    admin = await db.utilizadores.find_one({"role": "admin"}, {"_id": 0, "linkId": 1})
    return {"op": admin["linkId"] if admin else None}


# ---------------------------------------------------------------------------
# Gestão de contas (apenas admin)
# ---------------------------------------------------------------------------

@api.get("/admin/utilizadores")
async def admin_listar(admin: dict = Depends(admin_atual)):
    cursor = db.utilizadores.find({}, {"_id": 0, "senha_hash": 0})
    contas = await cursor.to_list(length=500)
    contas.sort(key=lambda c: (c.get("role") != "admin", c.get("email", "")))
    return {"contas": contas}


@api.post("/admin/utilizadores")
async def admin_criar(dados: NovoUtilizadorIn, admin: dict = Depends(admin_atual)):
    email = dados.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Email invalido.")
    if len(dados.password) < 4:
        raise HTTPException(status_code=400, detail="A palavra-passe deve ter pelo menos 4 caracteres.")
    if await db.utilizadores.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Ja existe uma conta com esse email.")
    doc = {
        "email": email,
        "senha_hash": hash_password(dados.password),
        "linkId": uuid.uuid4().hex[:10],
        "role": "tecnico",
        "criado": agora(),
    }
    await db.utilizadores.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("senha_hash", None)
    return {"ok": True, "conta": doc}


@api.delete("/admin/utilizadores/{email}")
async def admin_apagar(email: str, admin: dict = Depends(admin_atual)):
    alvo = email.strip().lower()
    if alvo == admin["email"]:
        raise HTTPException(status_code=400, detail="Nao pode apagar a sua propria conta.")
    doc = await db.utilizadores.find_one({"email": alvo})
    if not doc:
        raise HTTPException(status_code=404, detail="Conta nao encontrada.")
    if doc.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Nao e possivel apagar uma conta de administrador.")
    await db.utilizadores.delete_one({"email": alvo})
    await db.sessoes.delete_many({"operador": alvo})
    return {"ok": True}


@api.post("/admin/encaminhar")
async def admin_encaminhar(dados: EncaminharIn, admin: dict = Depends(admin_atual)):
    alvo = dados.para.strip().lower()
    destino = await db.utilizadores.find_one({"email": alvo})
    if not destino:
        raise HTTPException(status_code=404, detail="Tecnico nao encontrado.")
    doc = await db.sessoes.find_one({"id": dados.sessaoId})
    if not doc:
        raise HTTPException(status_code=404, detail="Sessao nao encontrada.")
    origem = doc["operador"]
    if origem == alvo:
        return {"ok": True}
    await db.sessoes.update_one({"id": dados.sessaoId}, {"$set": {"operador": alvo}})
    await enviar_lista(origem)
    await enviar_lista(alvo)
    return {"ok": True}


@api.post("/auth/senha")
async def mudar_senha(dados: SenhaIn, user: dict = Depends(utilizador_atual)):
    doc = await db.utilizadores.find_one({"email": user["email"]})
    if not verify_password(dados.atual, doc["senha_hash"]):
        raise HTTPException(status_code=400, detail="Palavra-passe atual incorreta.")
    if len(dados.nova) < 4:
        raise HTTPException(status_code=400, detail="A nova palavra-passe e demasiado curta.")
    await db.utilizadores.update_one(
        {"email": user["email"]}, {"$set": {"senha_hash": hash_password(dados.nova)}}
    )
    return {"ok": True}


@api.get("/sessoes")
async def listar_sessoes(user: dict = Depends(utilizador_atual)):
    docs = await db.sessoes.find({"operador": user["email"]}, {"_id": 0}).sort("inicio", -1).to_list(1000)
    return docs


@api.patch("/sessoes/{sessao_id}")
async def renomear_sessao(sessao_id: str, dados: RenomearIn, user: dict = Depends(utilizador_atual)):
    res = await db.sessoes.update_one(
        {"id": sessao_id, "operador": user["email"]}, {"$set": {"nome": dados.nome.strip()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sessao nao encontrada.")
    await enviar_lista(user["email"])
    return {"ok": True}


@api.delete("/sessoes/{sessao_id}")
async def apagar_sessao(sessao_id: str, user: dict = Depends(utilizador_atual)):
    await db.sessoes.delete_one({"id": sessao_id, "operador": user["email"]})
    await enviar_lista(user["email"])
    return {"ok": True}


@api.delete("/sessoes")
async def limpar_tudo(user: dict = Depends(utilizador_atual)):
    await db.sessoes.delete_many({"operador": user["email"]})
    await enviar_lista(user["email"])
    return {"ok": True}


fastapi_app.include_router(api)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Socket.IO (co-browsing + WebRTC signaling)
# ---------------------------------------------------------------------------

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", ping_timeout=60)
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="api/socketio")

sid_operador: dict[str, str] = {}      # tech sid -> email
sid_sessao: dict[str, str] = {}        # client sid -> sessao id
sessao_tecnicos: dict[str, set] = {}   # sessao id -> set(tech sids watching)
sid_extensao: dict[str, str] = {}      # extension sid -> sessao id
sessao_extensao: dict[str, set] = {}   # sessao id -> set(extension sids)


def agora() -> str:
    return datetime.now(timezone.utc).isoformat()


async def enviar_lista(email: str):
    docs = await db.sessoes.find({"operador": email}, {"_id": 0}).sort("inicio", -1).to_list(1000)
    await sio.emit("sessoes:atualizar", docs, room=f"op:{email}")


@sio.event
async def connect(sid, environ, auth):
    if auth and auth.get("token"):
        email = decodificar_token(auth["token"])
        if email:
            sid_operador[sid] = email
            await sio.enter_room(sid, f"op:{email}")
            docs = await db.sessoes.find({"operador": email}, {"_id": 0}).sort("inicio", -1).to_list(1000)
            await sio.emit("sessoes:atualizar", docs, to=sid)


@sio.on("cliente:hello")
async def cliente_hello(sid, data):
    op = (data or {}).get("op")
    token = (data or {}).get("token")
    ua = (data or {}).get("userAgent", "Desconhecido")

    dono = await db.utilizadores.find_one({"linkId": op})
    if not dono:
        await sio.emit("cliente:erro", {"msg": "Link invalido. Peca um novo link ao seu tecnico."}, to=sid)
        return

    sessao = None
    if token:
        sessao = await db.sessoes.find_one({"token": token})

    if sessao:
        await db.sessoes.update_one(
            {"id": sessao["id"]},
            {"$set": {"online": True, "sid": sid, "userAgent": ua, "ultimaAtividade": agora()}},
        )
        sessao = await db.sessoes.find_one({"id": sessao["id"]})
    else:
        novo = {
            "id": str(uuid.uuid4()),
            "token": str(uuid.uuid4()),
            "operador": dono["email"],
            "nome": "",
            "userAgent": ua,
            "inicio": agora(),
            "ultimaAtividade": agora(),
            "online": True,
            "aPartilhar": False,
            "modo": "ecra",
            "sid": sid,
        }
        await db.sessoes.insert_one(novo)
        sessao = novo

    sid_sessao[sid] = sessao["id"]
    sessao_tecnicos.setdefault(sessao["id"], set())
    await sio.enter_room(sid, f"sess:{sessao['id']}")
    await sio.emit("cliente:sessao", {"id": sessao["id"], "token": sessao["token"]}, to=sid)
    await enviar_lista(sessao["operador"])


@sio.on("cliente:partilhar")
async def cliente_partilhar(sid, data):
    sessao_id = sid_sessao.get(sid)
    if not sessao_id:
        # corrida possível com cliente:hello — aguarda o mapeamento ser escrito
        for _ in range(20):
            await asyncio.sleep(0.1)
            sessao_id = sid_sessao.get(sid)
            if sessao_id:
                break
    if not sessao_id:
        return
    ativo = bool((data or {}).get("ativo"))
    await db.sessoes.update_one(
        {"id": sessao_id}, {"$set": {"aPartilhar": ativo, "ultimaAtividade": agora()}}
    )
    doc = await db.sessoes.find_one({"id": sessao_id})
    await enviar_lista(doc["operador"])
    if ativo and sessao_tecnicos.get(sessao_id):
        await sio.emit("tecnico:pronto", {}, to=sid)


@sio.on("tecnico:ver")
async def tecnico_ver(sid, data):
    email = sid_operador.get(sid)
    sessao_id = (data or {}).get("sessaoId")
    if not email or not sessao_id:
        return
    doc = await db.sessoes.find_one({"id": sessao_id, "operador": email})
    if not doc:
        await sio.emit("tecnico:erro", {"msg": "Sessao nao pertence a este operador."}, to=sid)
        return
    await sio.enter_room(sid, f"sess:{sessao_id}")
    sessao_tecnicos.setdefault(sessao_id, set()).add(sid)
    if doc.get("sid"):
        await sio.emit("tecnico:pronto", {}, to=doc["sid"])


@sio.on("tecnico:parar")
async def tecnico_parar(sid, data):
    sessao_id = (data or {}).get("sessaoId")
    if sessao_id:
        sessao_tecnicos.get(sessao_id, set()).discard(sid)
        await sio.leave_room(sid, f"sess:{sessao_id}")


@sio.on("tecnico:pedir-reconexao")
async def tecnico_pedir_reconexao(sid, data):
    email = sid_operador.get(sid)
    sessao_id = (data or {}).get("sessaoId")
    if not email or not sessao_id:
        return
    doc = await db.sessoes.find_one({"id": sessao_id, "operador": email})
    if not doc or not doc.get("sid"):
        return
    await sio.emit("cliente:pedir-reconexao", {}, to=doc["sid"])


@sio.on("webrtc:offer")
async def webrtc_offer(sid, data):
    sessao_id = sid_sessao.get(sid)
    if not sessao_id:
        return
    await sio.emit("webrtc:offer", {"sdp": data.get("sdp"), "sessaoId": sessao_id}, room=f"sess:{sessao_id}", skip_sid=sid)


@sio.on("webrtc:answer")
async def webrtc_answer(sid, data):
    email = sid_operador.get(sid)
    sessao_id = (data or {}).get("sessaoId")
    if not email or not sessao_id:
        return
    doc = await db.sessoes.find_one({"id": sessao_id, "operador": email})
    if not doc:
        return
    await sio.emit("webrtc:answer", {"sdp": data.get("sdp")}, room=f"sess:{sessao_id}", skip_sid=sid)


@sio.on("webrtc:ice")
async def webrtc_ice(sid, data):
    candidate = (data or {}).get("candidate")
    if sid in sid_sessao:
        sessao_id = sid_sessao[sid]
    else:
        sessao_id = (data or {}).get("sessaoId")
    if not sessao_id:
        return
    await sio.emit("webrtc:ice", {"candidate": candidate, "sessaoId": sessao_id}, room=f"sess:{sessao_id}", skip_sid=sid)


@sio.on("tecnico:clique")
async def tecnico_clique(sid, data):
    email = sid_operador.get(sid)
    sessao_id = (data or {}).get("sessaoId")
    if not email or not sessao_id:
        return
    doc = await db.sessoes.find_one({"id": sessao_id, "operador": email})
    if not doc:
        return
    payload = {"x": data.get("x"), "y": data.get("y")}
    if doc.get("sid"):
        await sio.emit("tecnico:clique", payload, to=doc["sid"])
    for ext_sid in list(sessao_extensao.get(sessao_id, set())):
        await sio.emit("tecnico:clique", payload, to=ext_sid)


@sio.on("extensao:hello")
async def extensao_hello(sid, data):
    token = (data or {}).get("token")
    if not token:
        return
    doc = await db.sessoes.find_one({"token": token})
    if not doc:
        await sio.emit("extensao:erro", {"msg": "Sessao nao encontrada."}, to=sid)
        return
    sid_extensao[sid] = doc["id"]
    sessao_extensao.setdefault(doc["id"], set()).add(sid)
    await sio.enter_room(sid, f"sess:{doc['id']}")
    await db.sessoes.update_one({"id": doc["id"]}, {"$set": {"extensao": True, "ultimaAtividade": agora()}})
    await sio.emit("extensao:ok", {"sessaoId": doc["id"], "operador": doc["operador"]}, to=sid)
    await enviar_lista(doc["operador"])


@sio.event
async def disconnect(sid):
    if sid in sid_operador:
        del sid_operador[sid]
        for techs in sessao_tecnicos.values():
            techs.discard(sid)
        return
    if sid in sid_extensao:
        sessao_id = sid_extensao.pop(sid)
        sessao_extensao.get(sessao_id, set()).discard(sid)
        return
    if sid in sid_sessao:
        sessao_id = sid_sessao.pop(sid)
        doc = await db.sessoes.find_one({"id": sessao_id})
        # Robustez: so marca offline se este socket ainda for o dono atual da sessao.
        if doc and doc.get("sid") == sid:
            await db.sessoes.update_one(
                {"id": sessao_id},
                {"$set": {"online": False, "aPartilhar": False, "sid": None, "ultimaAtividade": agora()}},
            )
            await enviar_lista(doc["operador"])


# ---------------------------------------------------------------------------
# Seeding a partir do .env
# ---------------------------------------------------------------------------

async def upsert_utilizador(email: str, senha: str, role: str = "tecnico"):
    email = email.strip().lower()
    if not email:
        return
    existente = await db.utilizadores.find_one({"email": email})
    if not existente:
        await db.utilizadores.insert_one({
            "email": email,
            "senha_hash": hash_password(senha),
            "linkId": uuid.uuid4().hex[:10],
            "role": role,
            "criado": agora(),
        })
        logger.info("Conta criada: %s (%s)", email, role)
    else:
        updates = {}
        if not verify_password(senha, existente["senha_hash"]):
            updates["senha_hash"] = hash_password(senha)
        if not existente.get("linkId"):
            updates["linkId"] = uuid.uuid4().hex[:10]
        # backfill/promoção de role (nunca despromove um admin existente)
        if not existente.get("role"):
            updates["role"] = role
        elif role == "admin" and existente.get("role") != "admin":
            updates["role"] = "admin"
        if updates:
            await db.utilizadores.update_one({"email": email}, {"$set": updates})
            logger.info("Conta reposta: %s", email)


@fastapi_app.on_event("startup")
async def arranque():
    await db.utilizadores.create_index("email", unique=True)
    await db.utilizadores.create_index("linkId")
    await db.sessoes.create_index("token")
    await db.sessoes.create_index("operador")

    # Conta administradora (gere contas + recebe as ligações da app Android)
    admin_email = os.environ.get("ADMIN_MASTER_USER")
    admin_pass = os.environ.get("ADMIN_MASTER_PASSWORD")
    if admin_email and admin_pass:
        await upsert_utilizador(admin_email, admin_pass, role="admin")

    await upsert_utilizador(os.environ["ADMIN_USER"], os.environ["ADMIN_PASSWORD"])

    senha_ops = os.environ.get("OPERADORES_PASSWORD", "")
    for email in os.environ.get("OPERADORES", "").split(","):
        if email.strip():
            await upsert_utilizador(email, senha_ops)

    for par in os.environ.get("OPERADORES_EXTRA", "").split(","):
        if ":" in par:
            email, senha = par.split(":", 1)
            await upsert_utilizador(email, senha)

    logger.info("Seeding concluido.")


@fastapi_app.on_event("shutdown")
async def encerrar():
    client.close()
