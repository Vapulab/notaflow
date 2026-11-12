# Campaign Links

Every link to NotaFlow in a post, a bio, or a group message carries `utm_*` parameters. With them, the server records where each signup came from, and PostHog counts visits and signups by source.

## Links

| Where | Link |
| --- | --- |
| Instagram bio | `https://notaflow.vapulab.com/?utm_source=instagram&utm_medium=bio` |
| Instagram stories | `https://notaflow.vapulab.com/?utm_source=instagram&utm_medium=stories` |
| WhatsApp group | `https://notaflow.vapulab.com/?utm_source=whatsapp&utm_medium=grupo&utm_campaign=grupo-<cidade>` |
| LinkedIn post | `https://notaflow.vapulab.com/?utm_source=linkedin&utm_medium=post` |
| Facebook post or group | `https://notaflow.vapulab.com/?utm_source=facebook&utm_medium=post` |

For a WhatsApp group, replace `<cidade>` with the city, for example `grupo-sao-paulo`.

## Rules for a new link

- **`utm_source`** is required. It names the network or the place: `instagram`, `whatsapp`, `linkedin`, `facebook`.
- **`utm_medium`** says where in that network: `bio`, `stories`, `post`, `grupo`.
- **`utm_campaign`** names one action or one group, such as `lancamento` or `grupo-campinas`.
- **Only lowercase letters, digits, `-`, and `_`**, with at most 100 characters. Use no space and no accent. The server drops a value that breaks this rule. When `utm_source` is dropped, the signup has no source.
- **Use the same value for the same thing.** `instagram` and `Instagram` count as the same source, but `insta` does not.

## Where to see the results

- **Signups by source:** the query in [Onboarding](../ENGINEERING/ARCHITECTURE/ONBOARDING.md), section "Signup source". It counts every signup and the confirmed ones.
- **Visits and the funnel:** PostHog. The landing page views carry the `utm_*`. The `signup_completed` event carries `method` and the `utm_*`.
