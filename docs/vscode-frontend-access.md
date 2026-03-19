# VS Code frontend access

Use this when you want to run and open the WineNow frontend directly from VS Code.

## Quick start

1. Open the repository in VS Code.
2. Copy `.env.example` to `.env.local`.
3. Run the task **WineNow: install dependencies** once.
4. Start the task **WineNow: dev server** or launch **WineNow: launch frontend** from the Run and Debug panel.
5. If you are in a remote/container workspace, make sure port `3000` is forwarded.

## What was added

- `npm run dev:vscode` runs Next.js on `0.0.0.0:3000` so VS Code port forwarding can expose it.
- `.vscode/tasks.json` provides install and dev-server tasks.
- `.vscode/launch.json` opens the frontend at `http://localhost:3000`.
- `.vscode/extensions.json` recommends Tailwind, ESLint, and TypeScript tooling.

## Manual fallback

If you prefer the terminal:

```bash
cp .env.example .env.local
npm install
npm run dev:vscode
```

Then open the forwarded/local URL shown by VS Code.
