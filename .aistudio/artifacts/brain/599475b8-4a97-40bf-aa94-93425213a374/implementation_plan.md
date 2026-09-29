# Plano de Reformulação Completa: Cyberpunk RED RPG Companion

Este plano estabelece as melhorias estruturais para transformar a experiência de jogo em uma campanha imersiva, determinística e consistente, baseada nas regras de Cyberpunk RED e com elementos de interface inspirados no comunicador de *Cyberpunk 2077*.

---

## 1. Criação de Personagem & Ficha Balanceada (Cyberpunk RED Oficial)
- **Regra de Pontos & Limite de Atributos:**
  - Limite oficial de pontos de atributos (Point-Buy padrão de 62 pontos para *Streetrat* / *Edgerunner* / *Complete Package*).
  - Teto rígido por atributo: Mínimo 2, Máximo 8 na criação (evitando atributos estourados).
  - Correção imediata da vida inicial: O personagem inicia com PVs cheios ($PV = 10 + 5 \times \lceil(BODY + WILL)/2\rceil$) e status de ferimento limpo ("Íntegro / 100%").
- **Integração Real da Ficha com o Jogo:**
  - O inventário gerencia munição de armas dinamicamente (disparos consom pentes; recarga consome balas do estoque).
  - Redução automática de armadura (SP - *Stopping Power*) e PVs quando atingido.

---

## 2. Sistema de Combate e Resolução Determinística de Ações
- **Resolução Determinística de Ataque & Dano:**
  - A IA passa a fornecer o DV da manobra/ataque no payload estruturado.
  - Se o teste do jogador atingir ou superar o DV, o cálculo de dano da arma equipada (ex: `3d6`, `2d6`) e o consumo de munição são resolvidos na hora de forma determinística, sem depender de "memória" de turnos da IA.
  - O resultado consolidado (Acerto + Dano total + Crítico + SP inimigo penetrado) é enviado ao Mestre para descrever o impacto na cena de forma visceral e rápida.
- **Iniciativa & Estados de Combate:**
  - Em situações de combate, o jogo estabelece a ordem de iniciativa ($1d10 + REF$) e exibe no topo da tela os participantes da cena com suas condições atuais.

---

## 3. Interface de Comunicador Holo-Phone / Agent (Estilo CP2077)
- **Substituição do Menu Estático por um Holo-Phone Interativo:**
  - Um smartphone holográfico temático no canto da tela (com efeito sonoro e alerta visual quando recebe mensagens).
  - **Aba de Mensagens/Chats:** Contatos conhecidos (Fixers, familiares, aliados) enviam mensagens de texto, áudios curtos ou contratos/bicos com escolhas de resposta rápida.
  - **Aba de Registro de Objetivos/Trilhas (Journal):** Missão principal ativa, objetivos secundários e status de pagamento em eddies.
  - **Aba de Contatos & Dossiês:** Lista de pessoas de confiança e rivais sem duplicação de entidades.

---

## 4. Prólogo Cinematográfico Guiado & Narrativa Cyberpunk
- **Tutorial & Prólogo com Propósito:**
  - Início com um objetivo central forte: uma dívida urgente ou um bico clandestino que introduz as mecânicas em etapas (1º: Percepção/Investigação, 2º: Furtividade/Hacking, 3º: Combate e Fuga).
  - Fim das "missões aleatórias desconexas": cada ato se desdobra em consequências duradouras para a reputação do Edgerunner.
- **Ajuste de Tom e Ritmo da Narrativa:**
  - Textos objetivos, com diálogos estilizados no linguajar das ruas de Night City (*choom, gonk, eddies, delta*), evitando narrações excessivamente prolixas.

---

## 5. Memória de Mundo & Desduplicação de Entidades
- **Fusão Inteligente de Memória:**
  - Normalização de IDs de NPCs e entidades por chave única canônica (ex: `npc_elena_black`, `npc_fixer_padre`).
  - Previne que menções repetidas ao mesmo parente ou fixer gerem clones no estado da campanha.
  - Persistência das relações e status de dívidas através das sessões.

---

## 6. Testes Automatizados de Regressão
- Expandir a suíte de testes (`npm test`) para cobrir:
  - Consumo de munição e cálculo de dano/armadura.
  - Validação de pontos e teto de atributos na criação de ficha.
  - Desduplicação de NPCs na memória de campanha.

---

### Solicitação de Confirmação
Por favor, revise o plano acima e clique em **Proceed** para iniciarmos a implementação de todas as melhorias.
