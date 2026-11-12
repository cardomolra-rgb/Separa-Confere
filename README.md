# Separa & Confere

App para separação e conferência de pedidos sem papel, feito para usar no celular.

- **Separação** item a item, com endereço do estoque, "Peguei tudo", "Sem estoque" e edição.
- **Conferência** com recontagem às cegas, divergências e devolução para a separação.
- **Lista de faltantes** pronta para enviar pelo WhatsApp.
- **Login por PIN** com funções: Separação, Conferência e Gerente.
- **Tempo real** entre aparelhos, com aviso de conflito e fila offline.
- **Instalável** na tela inicial (PWA).

## Estrutura

Site estático, sem build:

| Arquivo | Para quê |
|---|---|
| `index.html` | Página do app |
| `app.js` | Toda a lógica (telas, sessão, gravação no Supabase) |
| `app.css` | Visual, com tema claro e escuro |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Instalação no celular e cache offline |
| `supabase/schema.sql` | Tabelas e funções do banco (já aplicadas) |

O banco fica no Supabase, em tabelas com prefixo `sc_`. O app só acessa o banco por funções (`sc_entrar`, `sc_listar_pedidos`, `sc_salvar_pedido`...), que conferem o token da sessão e a função de quem chama. As tabelas não podem ser lidas diretamente com a chave pública.

## Publicar

**Vercel ou Netlify:** importe este repositório. Não precisa de comando de build nem de pasta de saída (deixe em branco). Cada push na `main` atualiza o app.

## Primeiro acesso

A primeira pessoa que abrir o app cria o usuário **gerente**. Depois, no menu do nome, ele cadastra os operadores e os PINs.
