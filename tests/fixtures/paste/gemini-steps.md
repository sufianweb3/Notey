To deploy on Cloudflare:

1.  **Install Wrangler:** `pnpm add -D wrangler`
2.  **Log in:** run `wrangler login` and approve in the browser.
3.  **Deploy:**
    ```bash
    pnpm deploy:cf
    ```
4.  **Set the secret:**
    *   Generate 32 random bytes.
    *   Run `wrangler secret put NOTEY_SECRET`.

**Note:** the first deploy creates the D1 database and R2 bucket for you.
