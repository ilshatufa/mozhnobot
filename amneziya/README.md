# Amneziya Agent

HTTP API-обертка над AmneziaWG.

Запускать только через Docker/Compose из корня проекта:

```bash
docker compose up amneziya
```

Проверка:

```bash
curl -H "Authorization: Bearer $AMNEZIA_AGENT_TOKEN" http://localhost:8080/health
```

Peer endpoints пока зафиксированы как контракт API и возвращают `501 Not implemented`.
