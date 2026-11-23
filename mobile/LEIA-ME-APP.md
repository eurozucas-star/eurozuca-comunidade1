# App Eurozuca para Android e iOS

A app abre o site da Eurozuca dentro de uma app nativa (Capacitor), com ícone, ecrã de arranque e página própria quando não há internet. Contas, anúncios e pagamentos são os mesmos do site: o que muda no site muda logo na app, sem publicar uma versão nova.

Endereço que a app abre: `server.url` em `capacitor.config.json` (agora `https://eurozuca-comunidade1.vercel.app`). Quando ligar o domínio eurozuca.com a este projeto na Vercel, troque para `https://www.eurozuca.com` e corra `npx cap sync`.

## Opção 1 — Instalar já pelo navegador (grátis)

O site passou a ser uma PWA (app instalável):
- **Android (Chrome):** abrir o site → menu ⋮ → **Instalar app**.
- **iPhone (Safari):** abrir o site → botão **Partilhar** → **Adicionar ao ecrã principal**.

## Opção 2 — APK de teste no Android

1. Envie `eurozuca-android-teste.apk` para o telemóvel (WhatsApp, e-mail, Google Drive).
2. Abra o ficheiro e permita "Instalar apps desconhecidas" quando o Android pedir.

O GitHub gera um APK novo sozinho: separador **Actions → App mobile → Run workflow**, e o APK aparece em "Artifacts".

## Opção 3 — Publicar na Google Play

1. Criar conta em play.google.com/console (taxa única de 25 USD).
2. Criar a chave de assinatura (uma vez, guarde-a bem — sem ela não consegue atualizar a app):
   ```bash
   keytool -genkey -v -keystore eurozuca-release.jks -alias eurozuca -keyalg RSA -keysize 2048 -validity 10000
   ```
3. No GitHub → Settings → Secrets and variables → Actions, crie:
   - `ANDROID_KEYSTORE_BASE64` (o ficheiro .jks em base64: `base64 -w0 eurozuca-release.jks`)
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (eurozuca), `ANDROID_KEY_PASSWORD`
4. Corra o workflow **App mobile**: aparece o ficheiro `app-release.aab` para carregar na Play Console.
5. Na Play Console preencha: descrição, capturas de ecrã, política de privacidade (URL obrigatório), classificação de conteúdo e "Segurança dos dados" (a app recolhe nome, e-mail e WhatsApp).

## Opção 4 — Publicar na App Store (iPhone)

Precisa de:
- Conta **Apple Developer** (99 USD por ano).
- Um **Mac com Xcode**, ou um serviço na nuvem como Codemagic ou Ionic Appflow (compilam e enviam para a App Store sem Mac).

Passos com Mac: `cd mobile && npm install && npx cap sync ios && npx cap open ios` → no Xcode escolha a sua equipa em "Signing & Capabilities" → **Product → Archive** → **Distribute App**.

**Atenção:** a Apple rejeita apps que são só um site dentro de uma app (regra 4.2 "Minimum Functionality"). Para aumentar a hipótese de aprovação, convém juntar funções próprias da app: notificações de novos anúncios/pedidos, login com Face ID, partilha nativa, ecrã de anúncios guardados offline. A Google Play é mais tolerante.

## Comandos úteis

```bash
cd mobile
npm install
npx cap sync          # depois de mudar capacitor.config.json
npm run icons         # regenera ícones a partir de mobile/assets/
npx cap open android  # abre no Android Studio
npx cap open ios      # abre no Xcode (Mac)
```

Identificador da app: `com.eurozuca.app` (não pode ser alterado depois de publicar).
