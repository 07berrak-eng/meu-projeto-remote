import asyncio, socketio, os, requests

BASE = "http://localhost:8001"
# login admin para obter token + linkId
r = requests.post(BASE + "/api/auth/login", json={"email": "suporte@atlas.pt", "password": "Garciafinancas007"})
d = r.json()
token = d["token"]; linkId = d["linkId"]
print("linkId:", linkId)

recebido = {}

async def main():
    cli = socketio.AsyncClient()
    tec = socketio.AsyncClient()

    sessao = {}

    @cli.on("cliente:sessao")
    async def _(data):
        sessao["id"] = data["id"]
        print("[cliente] sessao:", data["id"])

    @cli.on("tecnico:clique")
    async def _(data):
        recebido["clique"] = data
        print("[cliente] RECEBEU clique:", data)

    @tec.on("connect")
    async def _():
        print("[tecnico] conectado")

    await cli.connect(BASE, socketio_path="api/socketio", transports=["websocket"])
    await cli.emit("cliente:hello", {"op": linkId, "token": None, "userAgent": "teste-cli"})
    await asyncio.sleep(1)
    await cli.emit("cliente:partilhar", {"ativo": True})
    await asyncio.sleep(0.5)

    await tec.connect(BASE, socketio_path="api/socketio", transports=["websocket"], auth={"token": token})
    await asyncio.sleep(0.5)
    await tec.emit("tecnico:ver", {"sessaoId": sessao["id"]})
    await asyncio.sleep(0.5)
    await tec.emit("tecnico:clique", {"sessaoId": sessao["id"], "x": 50, "y": 40})
    await asyncio.sleep(1)

    print("RESULTADO:", "OK - clique chegou" if "clique" in recebido else "FALHOU - clique NAO chegou")

    # limpar
    requests.delete(BASE + "/api/sessoes", headers={"Authorization": "Bearer " + token})
    await cli.disconnect(); await tec.disconnect()

asyncio.run(main())
