# GPT Clone frontend

React + Vite frontend for the existing Express and Socket.IO backend.

## Run locally

1. Start the backend on port `3000` from the `backend` directory.
2. In another terminal, run:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

The frontend reads `VITE_API_BASE_URL` as the backend origin. Production is configured to use `https://chatgpt-clone-zqlu.onrender.com`; REST requests add `/api` once, and Socket.IO connects to the same origin at `/socket.io`. Set `VITE_API_BASE_URL` in the environment when building for another backend. Cookie authentication remains enabled for both requests and the socket connection.

For a single Express deployment, use these commands from the repository root:

```sh
npm ci --prefix frontend && npm ci --prefix backend && npm --prefix backend run build
npm --prefix backend start
```

The build uses same-origin mode and copies `frontend/dist` into `backend/public`. API and Socket.IO traffic then use the same host as the page. The server listens on the hosting platform's `PORT` value when provided.

## Backend features used

- `POST /api/auth/register` with `{ fullName: { firstName, lastName }, email, password }`
- `POST /api/auth/login` with `{ email, password }`
- `POST /api/chat` with `{ title }`
- Socket.IO `ai-message` event with `{ chat, content }`
- Socket.IO `ai-response` event with `{ chat, content }`
- Socket.IO `ai-error` event for message processing failures

The backend currently has no chat-list endpoint, message-history endpoint, or logout endpoint. As a result, the sidebar lists only conversations created during the current page session, earlier messages cannot be restored after reload, and sign out clears the frontend profile but cannot invalidate the backend cookie. Add those backend endpoints for complete persistent history and server-side logout.

No API keys or JWTs are stored in browser storage. The frontend keeps only the returned user profile in `sessionStorage`.
