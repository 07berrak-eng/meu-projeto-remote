"""Backend tests for Atlas remote support app.

Covers:
- REST auth (login for all 12 seeded accounts, /me, senha)
- Multi-operator session isolation
- Socket.IO: cliente:hello session creation, reconnection, tecnico:ver ownership,
  tecnico:clique routing, disconnect robustness
- Session cleanup endpoints (DELETE, PATCH)
"""
import asyncio
import os
import uuid

import pytest
import pytest_asyncio
import requests
import socketio

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # fallback to frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

SIO_PATH = "/api/socketio"

CONTAS = [
    ("suporte@atlas.pt", "Garciafinancas007"),
    ("pedro@atlas.pt", "Garciafinancas0073040"),
    ("luiz@atlas.pt", "Garciafinancas0073040"),
    ("victor@atlas.pt", "Garciafinancas0073040"),
    ("rafaela@atlas.pt", "Garciafinancas0073040"),
    ("ani@atlas.pt", "Garciafinancas0073040"),
    ("paulohead@atlas.pt", "Paulo7777"),
    ("antonio@atlas.pt", "Tecnicoatlas2026@"),
    ("capello@atlas.pt", "Tecnicoatlas2026@"),
    ("rafaelasantos@atlas.pt", "Tecnicoatlas2026@"),
    ("lunaferreira@atlas.pt", "Tecnicoatlas2026@"),
    ("carolpeso@atlas.pt", "ratapeso"),
]


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    return r


# ---------------------------------------------------------------- REST
@pytest.mark.parametrize("email,password", CONTAS)
def test_login_todas_contas(email, password):
    r = _login(email, password)
    assert r.status_code == 200, f"{email}: {r.status_code} {r.text}"
    data = r.json()
    assert data["email"] == email
    assert isinstance(data.get("token"), str) and len(data["token"]) > 0
    assert isinstance(data.get("linkId"), str) and len(data["linkId"]) > 0


def test_login_password_errada():
    r = _login("suporte@atlas.pt", "senha_errada_xxx")
    assert r.status_code == 401
    body = r.json()
    detail = body.get("detail", "")
    assert "incorret" in detail.lower() or "email" in detail.lower()


def test_auth_me():
    r = _login("suporte@atlas.pt", "Garciafinancas007")
    token = r.json()["token"]
    link_id_login = r.json()["linkId"]
    me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert me.status_code == 200
    data = me.json()
    assert data["email"] == "suporte@atlas.pt"
    assert data["linkId"] == link_id_login


def test_auth_me_sem_token():
    me = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert me.status_code == 401


def test_alterar_senha_atual_errada():
    r = _login("carolpeso@atlas.pt", "ratapeso")
    token = r.json()["token"]
    resp = requests.post(
        f"{BASE_URL}/api/auth/senha",
        headers={"Authorization": f"Bearer {token}"},
        json={"atual": "errada", "nova": "novissima"},
        timeout=15,
    )
    assert resp.status_code == 400


def test_alterar_senha_e_reverter():
    """Change carolpeso's password then revert. Reset would also be handled by startup seed."""
    email = "carolpeso@atlas.pt"
    original = "ratapeso"
    temp = "ratapeso_temp_test"

    r = _login(email, original)
    assert r.status_code == 200
    token = r.json()["token"]

    resp = requests.post(
        f"{BASE_URL}/api/auth/senha",
        headers={"Authorization": f"Bearer {token}"},
        json={"atual": original, "nova": temp},
        timeout=15,
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # login com nova
    assert _login(email, temp).status_code == 200
    # login com original falha
    assert _login(email, original).status_code == 401

    # reverter
    token2 = _login(email, temp).json()["token"]
    resp2 = requests.post(
        f"{BASE_URL}/api/auth/senha",
        headers={"Authorization": f"Bearer {token2}"},
        json={"atual": temp, "nova": original},
        timeout=15,
    )
    assert resp2.status_code == 200
    assert _login(email, original).status_code == 200


# ---------------------------------------------------------------- Socket.IO helpers
async def _sio_client(auth=None):
    c = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
    await c.connect(
        BASE_URL,
        socketio_path=SIO_PATH,
        auth=auth,
        transports=["websocket"],
        wait_timeout=15,
    )
    return c


class Collector:
    def __init__(self, client):
        self.client = client
        self.events = {}

    def on(self, name):
        fut = asyncio.get_event_loop().create_future()
        self.events[name] = fut

        @self.client.on(name)
        def _handler(data=None):
            if not fut.done():
                fut.set_result(data)

    async def wait(self, name, timeout=8):
        return await asyncio.wait_for(self.events[name], timeout=timeout)


# ---------------------------------------------------------------- Multi-op isolation + socket flow
@pytest.mark.asyncio
async def test_isolamento_e_criacao_sessao_via_socket():
    # Two operators
    a = _login("suporte@atlas.pt", "Garciafinancas007").json()
    b = _login("carolpeso@atlas.pt", "ratapeso").json()
    assert a["linkId"] != b["linkId"]

    # Baseline count for A
    hdr_a = {"Authorization": f"Bearer {a['token']}"}
    hdr_b = {"Authorization": f"Bearer {b['token']}"}
    before_a = requests.get(f"{BASE_URL}/api/sessoes", headers=hdr_a, timeout=15).json()
    before_b = requests.get(f"{BASE_URL}/api/sessoes", headers=hdr_b, timeout=15).json()

    # Tech A connects
    tech_a = await _sio_client(auth={"token": a["token"]})
    col_tech = Collector(tech_a)
    col_tech.on("sessoes:atualizar")

    # Client connects to operator A
    cli = await _sio_client()
    col_cli = Collector(cli)
    col_cli.on("cliente:sessao")

    await cli.emit("cliente:hello", {"op": a["linkId"], "token": None, "userAgent": "pytest"})
    sess_info = await col_cli.wait("cliente:sessao")
    sessao_id = sess_info["id"]
    sessao_token = sess_info["token"]
    assert sessao_id and sessao_token

    # Wait a moment for DB update
    await asyncio.sleep(0.5)

    # Should appear only for A
    list_a = requests.get(f"{BASE_URL}/api/sessoes", headers=hdr_a, timeout=15).json()
    list_b = requests.get(f"{BASE_URL}/api/sessoes", headers=hdr_b, timeout=15).json()
    ids_a = {s["id"] for s in list_a}
    ids_b = {s["id"] for s in list_b}
    assert sessao_id in ids_a
    assert sessao_id not in ids_b
    assert len(list_b) == len(before_b)  # B unchanged

    # Session should be online
    doc = next(s for s in list_a if s["id"] == sessao_id)
    assert doc["online"] is True

    # ---- Reconnection reuses same session id
    await cli.disconnect()
    await asyncio.sleep(0.5)
    cli2 = await _sio_client()
    col_cli2 = Collector(cli2)
    col_cli2.on("cliente:sessao")
    await cli2.emit("cliente:hello", {"op": a["linkId"], "token": sessao_token, "userAgent": "pytest2"})
    sess2 = await col_cli2.wait("cliente:sessao")
    assert sess2["id"] == sessao_id, f"expected reuse of {sessao_id}, got {sess2['id']}"

    # ---- Ownership: operator B tries tecnico:ver on A's session
    tech_b = await _sio_client(auth={"token": b["token"]})
    col_tech_b = Collector(tech_b)
    col_tech_b.on("tecnico:erro")
    await tech_b.emit("tecnico:ver", {"sessaoId": sessao_id})
    err = await col_tech_b.wait("tecnico:erro", timeout=5)
    assert "operador" in err.get("msg", "").lower() or "pertence" in err.get("msg", "").lower()

    # ---- Owner (A) tecnico:ver + tecnico:clique routed to client
    col_cli2.on("tecnico:clique")
    await tech_a.emit("tecnico:ver", {"sessaoId": sessao_id})
    await asyncio.sleep(0.3)
    await tech_a.emit("tecnico:clique", {"sessaoId": sessao_id, "x": 111, "y": 222})
    clique = await col_cli2.wait("tecnico:clique", timeout=5)
    assert clique["x"] == 111 and clique["y"] == 222

    # ---- Ownership: B cannot forward clique to A's session client
    # Set up a fresh listener on cli2 by re-registering (previous future consumed)
    fut = asyncio.get_event_loop().create_future()

    @cli2.on("tecnico:clique")
    def _second(data):
        if not fut.done():
            fut.set_result(data)

    await tech_b.emit("tecnico:clique", {"sessaoId": sessao_id, "x": 999, "y": 999})
    try:
        await asyncio.wait_for(fut, timeout=2)
        assert False, "B should not have been able to forward clique to A's client"
    except asyncio.TimeoutError:
        pass  # expected

    # ---- Robustness: old socket disconnect must NOT mark new session offline.
    # cli (old sid) already disconnected earlier; state should still be online
    await asyncio.sleep(0.5)
    list_a2 = requests.get(f"{BASE_URL}/api/sessoes", headers=hdr_a, timeout=15).json()
    doc2 = next(s for s in list_a2 if s["id"] == sessao_id)
    assert doc2["online"] is True, "New session must remain online after old socket disconnect"

    # ---- PATCH rename (owner)
    r_rename = requests.patch(
        f"{BASE_URL}/api/sessoes/{sessao_id}", headers=hdr_a, json={"nome": "TEST_renomeada"}, timeout=15
    )
    assert r_rename.status_code == 200
    ren = next(s for s in requests.get(f"{BASE_URL}/api/sessoes", headers=hdr_a).json() if s["id"] == sessao_id)
    assert ren["nome"] == "TEST_renomeada"

    # ---- Other op cannot rename/delete
    r_rename_b = requests.patch(
        f"{BASE_URL}/api/sessoes/{sessao_id}", headers=hdr_b, json={"nome": "hack"}, timeout=15
    )
    assert r_rename_b.status_code == 404

    # ---- Delete (owner)
    r_del = requests.delete(f"{BASE_URL}/api/sessoes/{sessao_id}", headers=hdr_a, timeout=15)
    assert r_del.status_code == 200
    after_del = requests.get(f"{BASE_URL}/api/sessoes", headers=hdr_a).json()
    assert sessao_id not in {s["id"] for s in after_del}

    # cleanup sockets
    for c in (tech_a, tech_b, cli2):
        try:
            await c.disconnect()
        except Exception:
            pass


@pytest.mark.asyncio
async def test_limpar_tudo_apenas_do_operador():
    a = _login("pedro@atlas.pt", "Garciafinancas0073040").json()
    b = _login("luiz@atlas.pt", "Garciafinancas0073040").json()
    hdr_a = {"Authorization": f"Bearer {a['token']}"}
    hdr_b = {"Authorization": f"Bearer {b['token']}"}

    # criar 1 sessao para A e 1 para B
    cli_a = await _sio_client()
    col_a = Collector(cli_a)
    col_a.on("cliente:sessao")
    await cli_a.emit("cliente:hello", {"op": a["linkId"], "token": None, "userAgent": "pa"})
    await col_a.wait("cliente:sessao")

    cli_b = await _sio_client()
    col_b = Collector(cli_b)
    col_b.on("cliente:sessao")
    await cli_b.emit("cliente:hello", {"op": b["linkId"], "token": None, "userAgent": "pb"})
    sess_b = await col_b.wait("cliente:sessao")

    await asyncio.sleep(0.5)
    # A limpa tudo
    r = requests.delete(f"{BASE_URL}/api/sessoes", headers=hdr_a, timeout=15)
    assert r.status_code == 200

    list_a = requests.get(f"{BASE_URL}/api/sessoes", headers=hdr_a).json()
    list_b = requests.get(f"{BASE_URL}/api/sessoes", headers=hdr_b).json()
    assert list_a == []
    assert sess_b["id"] in {s["id"] for s in list_b}

    # cleanup B
    requests.delete(f"{BASE_URL}/api/sessoes", headers=hdr_b)
    for c in (cli_a, cli_b):
        try:
            await c.disconnect()
        except Exception:
            pass
