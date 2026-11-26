# PROTOTYPE: Managers as a team (throwaway, never merge)

Seven static views of a user's Managers as a team, on fixture data, drawn with `@repo/ui`.

    pnpm --filter @repo/catalog exec vite --port 5390
    open http://localhost:5390/prototype-team.html?variant=roster   # roster | building | newspaper | transit | cards | solar | studio, &theme=dark

`capture/` holds the Playwright scripts that took the screenshots and built the comparison page (vite must be running on 5390).
