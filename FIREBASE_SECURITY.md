# Firebase Security

Este projeto agora usa o Firestore como banco oficial. O arquivo `firestore.rules` define a regra de producao recomendada:

- usuarios ativos autenticados podem ler transacoes;
- usuarios ativos podem apenas dar baixa limitada em transacoes;
- somente administradores podem listar usuarios, aprovar, bloquear, alterar senha e excluir transacoes;
- novos cadastros publicos criam conta no Firebase Auth, entram como `operacional`, `active: false` e `status: pending`;
- nenhum usuario pode se criar como administrador pelo cadastro publico.
- `loginIndex/{username}` permite manter login por nome de usuario sem expor listagem de usuarios.

## Antes de publicar as regras

Confirme que os administradores acessam via Firebase Auth e que existe um documento em `users/{uid}` com:

```json
{
  "username": "junior",
  "name": "Administrador",
  "email": "email@dominio.com",
  "role": "admin",
  "active": true
}
```

O login legado por hash no Firestore foi removido. Contas sem Firebase Auth vinculado nao conseguem autenticar nem acessar transacoes; recrie ou migre esses acessos antes de liberar usuarios.

Novos usuarios criados pelo painel Admin ou pelo primeiro acesso ja devem receber:

- uma conta no Firebase Auth;
- um documento `users/{uid}`;
- `authUid`, `authEmail` e `authProvider: "firebase"` no perfil;
- um documento `loginIndex/{username}` quando aprovados, permitindo login por username.

Para manter login por username apos a migracao, cada usuario deve ter um documento `loginIndex/{username}` com:

```json
{
  "uid": "firebase-auth-uid",
  "authEmail": "email-usado-no-firebase-auth"
}
```

## Publicacao

Antes de publicar alteracoes nas regras, valide primeiro:

```bash
npm run deploy:rules:dry-run
```

Depois publique no projeto oficial:

```bash
npm run deploy:rules
```
