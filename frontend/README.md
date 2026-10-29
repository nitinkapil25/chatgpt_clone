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

The Vite dev server proxies `/api` and `/socket.io` to `http://localhost:3000`. This keeps cookie authentication on the same browser origin during development.

## Backend features used

- `POST /api/auth/register` with `{ fullName: { firstName, lastName }, email, password }`
- `POST /api/auth/login` with `{ email, password }`
- `POST /api/chat` with `{ title }`
- Socket.IO `ai-message` event with `{ chat, content }`
- Socket.IO `ai-response` event with `{ chat, content }`
- Socket.IO `ai-error` event for message processing failures

The backend currently has no chat-list endpoint, message-history endpoint, or logout endpoint. As a result, the sidebar lists only conversations created during the current page session, earlier messages cannot be restored after reload, and sign out clears the frontend profile but cannot invalidate the backend cookie. Add those backend endpoints for complete persistent history and server-side logout.

No API keys or JWTs are stored in browser storage. The frontend keeps only the returned user profile in `sessionStorage`.
