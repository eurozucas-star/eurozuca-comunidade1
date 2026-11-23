# Servidor da Comunidade Eurozuca

Este é o servidor de `eurozuca-comunidade.html`: contas de clientes (pessoa singular e empresa), login, anúncios (ofertas e pedidos), "os meus anúncios" e encerrar anúncios. Corre como Vercel Function em `/api/comunidade` e usa o Postgres do Supabase.

## Ficheiros

| Ficheiro | O que faz |
|---|---|
| `api/comunidade.js` | Ponto de entrada na Vercel (liga ao Supabase) |
| `lib/comunidade.js` | Regras: registo, login, anúncios, segurança |
| `lib/schema.js` / `supabase-schema.sql` | Tabelas da base de dados |
| `dev-server.js` | Servidor local para testes (sem Supabase) |
| `test/comunidade.test.js` | 14 testes automáticos |

## Configurar (uma vez)

1. **Supabase → Project Settings → Database → Connection string → "Transaction pooler"** (porta 6543). Copie a URL e troque `[YOUR-PASSWORD]` pela palavra-passe da base de dados.
2. **Vercel → projeto eurozuca-comunidade1 → Settings → Environment Variables**: crie `DATABASE_URL` com essa URL (Production e Preview).
3. Opcional: no Supabase, abra o **SQL Editor** e corra `supabase-schema.sql`. Se não o fizer, o servidor cria as tabelas sozinho no primeiro pedido.
4. Faça novo deploy na Vercel.

Teste: abra `https://SEU-DOMINIO/api/comunidade?action=directory`. Deve responder com `{"items":[]...}`.

## Testar no computador

```bash
npm install
npm test        # testes automáticos
npm run dev     # abre http://localhost:3000/eurozuca-comunidade.html
```

## Segurança incluída

- Palavras-passe guardadas com scrypt (nunca em texto).
- Sessão em cookie HttpOnly + Secure, válida 30 dias; tokens guardados só como hash.
- Bloqueio de força bruta: 6 tentativas falhadas por e-mail ou 20 por IP em 15 minutos.
- Proteção CSRF (só aceita JSON da mesma origem).
- Validação de todos os campos no servidor; pesquisa sem injeção SQL.
- Limites: 20 anúncios ativos por conta e 10 publicações por dia.
- Row Level Security ativado nas tabelas: a chave pública (anon) do Supabase não consegue ler os dados.

## Administração

Pelo **Table Editor** do Supabase:
- Remover um anúncio: em `ez_listings`, mude `status` para `removed`.
- Suspender uma conta: em `ez_accounts`, mude `status` para `blocked`.
- Ativar plano pago: em `ez_accounts`, mude `plan` para `empresa` ou `premium` (aparecem primeiro no diretório).

## Próximos passos

- Recuperar palavra-passe e confirmar e-mail (precisa de serviço de e-mail, ex.: Resend).
- Pagamentos Stripe dos planos com ativação automática do `plan` via webhook.
- Botão para o cliente apagar a conta (RGPD).
