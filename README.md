# UserDashboard

Homepage self-hosted per i servizi interni di un'azienda.

- **Pagina pubblica**: chiunque apra la homepage vede le icone e può usarle, senza login.
- **Portale admin** (`/admin`): login con un account **Active Directory / LDAP** che appartiene a un gruppo configurabile (di default il gruppo built-in `Administrators`, membership annidata inclusa, es. tramite `Domain Admins`).
- Gli amministratori possono:
  - aggiungere, modificare, riordinare (drag & drop) ed eliminare i collegamenti (nome, URL, descrizione, apertura in nuova scheda);
  - scegliere l'icona di ogni collegamento: iniziali su colore, emoji, immagine caricata o URL di un'immagine;
  - personalizzare titolo, sottotitolo, colore del testo e **sfondo** (tinta unita, sfumatura o immagine caricata con oscuramento/sfocatura), con anteprima live.

Nessun dato aziendale è incluso nel codice: dominio, domain controller e gruppo admin si impostano tramite variabili d'ambiente del container.

---

## Installazione con Docker

L'immagine è pubblicata su GitHub Container Registry:

```
ghcr.io/bluwolfer777/userdashboard:latest
```

### 1. Prepara la configurazione

Crea una cartella sul server Docker e al suo interno un file `.env` partendo da [`.env.example`](.env.example):

```env
LDAP_URL=ldap://dc01.example.local:389
LDAP_DOMAIN=example.local
SESSION_SECRET=una-stringa-casuale-lunga
```

Genera un `SESSION_SECRET` sicuro con:

```bash
openssl rand -hex 32
```

### 2a. Avvio con Docker Compose (consigliato)

Copia [`docker-compose.yml`](docker-compose.yml) nella stessa cartella del `.env`, poi:

```bash
docker compose up -d
```

### 2b. Avvio con `docker run`

```bash
docker run -d --name user-dashboard --restart unless-stopped \
  -p 8080:3000 \
  -v user-dashboard-data:/data \
  -e LDAP_URL=ldap://dc01.example.local:389 \
  -e LDAP_DOMAIN=example.local \
  -e SESSION_SECRET=una-stringa-casuale-lunga \
  ghcr.io/bluwolfer777/userdashboard:latest
```

### 3. Utilizzo

- Homepage: `http://<server>:8080/`
- Amministrazione: `http://<server>:8080/admin` (oppure l'icona ⚙ in basso a destra nella homepage)

Per accedere usa `utente`, `utente@dominio` oppure `DOMINIO\utente`.

---

## Variabili d'ambiente

| Variabile | Obbligatoria | Default | Descrizione |
|---|---|---|---|
| `LDAP_URL` | sì | – | URL del domain controller, es. `ldap://dc01.example.local:389` o `ldaps://dc01.example.local:636`. Si possono indicare più DC separati da virgola (failover in ordine) |
| `LDAP_DOMAIN` | sì* | – | Dominio DNS AD, usato come suffisso UPN (`mario` → `mario@example.local`) |
| `LDAP_BASE_DN` | no* | derivato da `LDAP_DOMAIN` | Base di ricerca, es. `DC=example,DC=local` |
| `LDAP_ADMIN_GROUP_DN` | no | `CN=Administrators,CN=Builtin,<BASE_DN>` | DN del gruppo autorizzato all'amministrazione (membership annidata supportata) |
| `LDAP_STARTTLS` | no | `false` | Usa StartTLS su una connessione `ldap://` |
| `LDAP_TLS_REJECT_UNAUTHORIZED` | no | `true` | Verifica il certificato del DC (LDAPS/StartTLS) |
| `LDAP_CA_CERT` | no | – | Percorso nel container di un certificato CA in formato PEM (montalo come volume) |
| `LDAP_TIMEOUT_MS` | no | `5000` | Timeout delle operazioni LDAP |
| `SESSION_SECRET` | consigliata | casuale | Chiave per firmare il cookie di sessione. Se assente le sessioni si perdono al riavvio |
| `SITE_TITLE` | no | `Dashboard` | Titolo iniziale (modificabile poi dal portale admin) |
| `TRUST_PROXY` | no | `false` | `true` se il container è dietro un reverse proxy |
| `COOKIE_SECURE` | no | `false` | `true` se il sito è servito in HTTPS (cookie solo HTTPS) |
| `SESSION_MAX_AGE_MINUTES` | no | `480` | Durata della sessione admin |
| `MAX_UPLOAD_MB` | no | `10` | Dimensione massima delle immagini caricate |
| `PORT` | no | `3000` | Porta interna del container |
| `DATA_DIR` | no | `/data` | Cartella dei dati (impostazioni e immagini) |
| `LOCAL_ADMIN_USER` / `LOCAL_ADMIN_PASSWORD` | no | – | Account admin locale di emergenza, attivo solo se entrambe sono impostate |

\* È necessario almeno uno tra `LDAP_DOMAIN` e `LDAP_BASE_DN`. Se si imposta solo `LDAP_BASE_DN` gli utenti devono accedere con `utente@dominio` o `DOMINIO\utente`.

### Come funziona l'autenticazione

1. Il container esegue un bind LDAP con le credenziali inserite dall'utente (nessun account di servizio necessario).
2. Cerca l'utente sotto `LDAP_BASE_DN` e verifica, con la regola `LDAP_MATCHING_RULE_IN_CHAIN`, che sia membro (anche indiretto) di `LDAP_ADMIN_GROUP_DN`.
3. Solo in quel caso viene creata la sessione admin.

Esempio con un gruppo dedicato invece di `Administrators`:

```env
LDAP_ADMIN_GROUP_DN=CN=Dashboard Admins,OU=Groups,DC=example,DC=local
```

### LDAPS con CA interna

```yaml
    environment:
      LDAP_URL: ldaps://dc01.example.local:636
      LDAP_CA_CERT: /certs/ca.pem
    volumes:
      - dashboard-data:/data
      - ./ca.pem:/certs/ca.pem:ro
```

---

## Reverse proxy / HTTPS

Dietro un reverse proxy (nginx, Traefik, Caddy, IIS ARR…) che termina HTTPS imposta:

```env
TRUST_PROXY=true
COOKIE_SECURE=true
```

## Backup

Tutti i dati (impostazioni e immagini caricate) sono nel volume montato su `/data`:

- `/data/settings.json`
- `/data/uploads/`

Basta fare il backup di quel volume.

## Aggiornamento

```bash
docker compose pull
docker compose up -d
```

---

## Build locale

```bash
git clone https://github.com/bluwolfer777/UserDashboard.git
cd UserDashboard
docker build -t userdashboard .
docker run --rm -p 8080:3000 --env-file .env -v userdashboard-data:/data userdashboard
```

Sviluppo senza Docker (Node.js 20+):

```bash
npm install
DATA_DIR=./data LOCAL_ADMIN_USER=admin LOCAL_ADMIN_PASSWORD=admin npm start
```

## CI

Il workflow [`.github/workflows/docker.yml`](.github/workflows/docker.yml) compila e pubblica l'immagine su GHCR (`linux/amd64` e `linux/arm64`) a ogni push su `main` e per ogni tag `v*`.

## Licenza

[GPL-3.0](LICENSE)
