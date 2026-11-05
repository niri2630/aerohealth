# AeroHealth frontend

This directory contains the React and TypeScript frontend for AeroHealth. It uses TanStack Start and Vite, and communicates with the FastAPI backend through the `VITE_API_URL` environment variable.

## Development

From this directory, create `.env.local` with the local API address, install dependencies, and start the development server:

```powershell
Set-Content .env.local 'VITE_API_URL=http://127.0.0.1:8000'
npm ci
npm run dev
```

The backend must be running separately. See the repository-root README for API setup and complete project instructions.

## Checks

```powershell
npm run lint
npm run build
```
