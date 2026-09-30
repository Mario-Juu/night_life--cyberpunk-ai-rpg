/**
 * Tutoriais de primeira vez: cada sistema se apresenta quando aparece pela primeira vez.
 * As ilustrações imitam a interface real (sem estado), para o jogador reconhecer depois.
 */
import type { ReactNode } from 'react';
import { ArrowDown, FileSearch, Hand, KeyRound, Map, Radar, Shield, Skull, Swords, Zap } from 'lucide-react';
import type { TutorialId } from '../../store/uiStore';
import { cn } from '../../ui';

export interface TutorialStep {
  title: string;
  body: ReactNode;
  visual?: ReactNode;
}

export interface Tutorial {
  id: TutorialId;
  title: string;
  steps: TutorialStep[];
}

// ---------------------------------------------------------------- peças visuais

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('border border-line bg-surface-0/70 p-3 text-xs space-y-1.5', className)}>{children}</div>;
}

function Roll({ parts, total, dv, ok }: { parts: string; total: number; dv: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 tabular">
      <span className="text-muted">{parts}</span>
      <span>
        <span className="text-fg">{total}</span> <span className="text-dim">vs {dv}</span>{' '}
        <span className={ok ? 'text-neon-green' : 'text-danger'}>{ok ? '✓' : '✗'}</span>
      </span>
    </div>
  );
}

function Floors({ you, rows }: { you: number; rows: Array<[string, 'fg' | 'dim' | 'danger' | 'green']> }) {
  return (
    <ol className="border border-line divide-y divide-line-soft">
      {rows.map(([label, tone], i) => (
        <li key={i} className={cn('flex items-center gap-2 px-2 py-1', i === you ? 'bg-neon-cyan/10 text-neon-cyan' : tone === 'dim' ? 'text-dim' : tone === 'danger' ? 'text-danger' : tone === 'green' ? 'text-neon-green' : 'text-fg')}>
          <span className="tabular w-4 text-right text-dim">{i + 1}</span>
          <span className="flex-1">{label}</span>
          {i === you && <span className="font-display text-[9px] tracking-widest">VOCÊ</span>}
        </li>
      ))}
    </ol>
  );
}

function Chip({ icon, children, tone = 'cyan' }: { icon?: ReactNode; children: ReactNode; tone?: 'cyan' | 'yellow' | 'danger' | 'green' | 'magenta' }) {
  const color = { cyan: 'border-neon-cyan/50 text-neon-cyan', yellow: 'border-neon-yellow/50 text-neon-yellow', danger: 'border-danger/50 text-danger', green: 'border-neon-green/50 text-neon-green', magenta: 'border-neon-magenta/50 text-neon-magenta' }[tone];
  return <span className={cn('inline-flex items-center gap-1 border px-1.5 py-0.5 font-display text-[10px] uppercase tracking-wider', color)}>{icon}{children}</span>;
}

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  return (
    <div className="h-1.5 bg-surface-2">
      <div className="h-full" style={{ width: `${(value / max) * 100}%`, background: tone }} />
    </div>
  );
}

// ---------------------------------------------------------------- conteúdo

export const TUTORIALS: Record<TutorialId, Tutorial> = {
  net: {
    id: 'net',
    title: 'A Rede',
    steps: [
      {
        title: 'Um ponto de acesso apareceu',
        body: (
          <>
            O Mestre revelou uma <b>arquitetura de Rede</b> perto de você. Ela é uma torre de andares: você entra pelo topo e desce. Só um <b>Trilheiro</b> com ciberdeck
            entra — os andares aparecem como <code>???</code> até você descobri-los.
          </>
        ),
        visual: (
          <Frame>
            <p className="eyebrow">Rede · Padrão · 6 andares</p>
            <p className="font-display text-neon-cyan uppercase tracking-wider">Servidor da Maelstrom</p>
            <Floors you={0} rows={[['Arquivo', 'fg'], ['???', 'dim'], ['???', 'dim'], ['???', 'dim'], ['???', 'dim'], ['???', 'dim']]} />
          </Frame>
        ),
      },
      {
        title: 'Ações de Rede',
        body: (
          <>
            A cada turno você tem <b>Ações de Rede</b> (3 no rank 4). Quase tudo é <b>Interface + 1d10</b> contra a dificuldade do sistema — é preciso <b>superar</b> o número.
            Conectar custa 1 ação.
          </>
        ),
        visual: (
          <Frame>
            <div className="flex items-center gap-2">
              <span className="text-muted">Ações:</span>
              {[1, 1, 0].map((f, i) => (
                <span key={i} className={cn('w-2.5 h-2.5 border', f ? 'bg-neon-cyan border-neon-cyan' : 'border-line')} />
              ))}
            </div>
            <Roll parts="Backdoor: Interface 4 + d10 7" total={11} dv="senha 8" ok />
            <Roll parts="Eye-Dee: Interface 4 + d10 3" total={7} dv="arquivo 8" ok={false} />
          </Frame>
        ),
      },
      {
        title: 'Descendo a torre',
        body: (
          <>
            <b>Pathfinder</b> mapeia os andares abaixo. <b>Senhas</b> bloqueiam a descida até você usar <b>Backdoor</b>. <b>Eye-Dee</b> baixa arquivos para o seu inventário.
            <b> Control</b> toma câmeras, portas e torretas do mundo real — o Mestre reflete isso na cena.
          </>
        ),
        visual: (
          <Frame>
            <div className="flex flex-wrap gap-1">
              <Chip icon={<Map className="w-3 h-3" />}>Pathfinder</Chip>
              <Chip icon={<KeyRound className="w-3 h-3" />} tone="yellow">Backdoor</Chip>
              <Chip icon={<FileSearch className="w-3 h-3" />} tone="yellow">Eye-Dee</Chip>
              <Chip icon={<ArrowDown className="w-3 h-3" />}>Descer</Chip>
            </div>
            <Floors you={2} rows={[['Arquivo', 'fg'], ['Senha (aberta)', 'fg'], ['ICE Negro: Hellhound', 'danger'], ['Nó de controle: câmeras', 'fg'], ['???', 'dim']]} />
          </Frame>
        ),
      },
      {
        title: 'ICE Negro',
        body: (
          <>
            Programas assassinos. Quando você entra no andar dele, rola-se velocidade; depois ele <b>te persegue</b> e ataca no fim de cada turno. O dano é <b>cerebral</b>: vai
            direto nos seus PV, sem armadura. Revide com <b>Zap</b> ou <b>Sword</b>, ou fuja com <b>Slide</b>. O programa <b>Armor</b> absorve 4.
          </>
        ),
        visual: (
          <Frame className="border-danger/40">
            <div className="flex items-center justify-between">
              <span className="font-display uppercase tracking-wider text-danger">Hellhound</span>
              <span className="text-dim">perseguindo</span>
            </div>
            <Bar value={12} max={20} tone="#ff003c" />
            <p className="text-dim">2d6 de dano cerebral e seu deck pega fogo.</p>
            <div className="flex gap-1">
              <Chip icon={<Zap className="w-3 h-3" />} tone="yellow">Zap</Chip>
              <Chip icon={<Swords className="w-3 h-3" />} tone="danger">Sword</Chip>
              <Chip icon={<Shield className="w-3 h-3" />} tone="green">Rezzar Armor</Chip>
            </div>
          </Frame>
        ),
      },
      {
        title: 'Saindo vivo',
        body: (
          <>
            Quando as ações acabam (ou em <b>Encerrar turno</b>) o ICE reage e o Mestre narra o lote. Saia com <b>Sair com segurança</b> (1 ação). Ser arrancado da Rede (o ICE
            Giant faz isso) é uma <b>desconexão insegura</b>: todo ICE ativo te atinge na saída. Seu corpo continua no mundo real — e vulnerável.
          </>
        ),
        visual: (
          <Frame>
            <p className="text-neon-green">✓ Desconexão segura: a rede se recompõe; o que você baixou fica com você.</p>
            <p className="text-danger">✗ Desconexão insegura: Hellhound + Wisp te acertam na saída.</p>
            <p className="text-dim">Também dá para jogar por texto: “me conecto, uso o Pathfinder e desço”.</p>
          </Frame>
        ),
      },
    ],
  },

  combat: {
    id: 'combat',
    title: 'Combate',
    steps: [
      {
        title: 'O motor resolve, o Mestre narra',
        body: (
          <>
            Cada inimigo tem uma ficha (PV, blindagem, arma). Ataque pelo painel ou por texto: o jogo rola <b>REF/DEX + perícia + 1d10</b> contra a esquiva ou a distância do alvo.
            O resultado só aparece junto com a narração.
          </>
        ),
        visual: (
          <Frame className="border-danger/40">
            <div className="flex justify-between">
              <span className="text-fg">Ganger da Maelstrom 1</span>
              <Chip tone="danger">Ativo</Chip>
            </div>
            <p className="tabular text-muted">Pistola muito pesada (4d6) · corpo a corpo</p>
            <Bar value={30} max={30} tone="#ff003c" />
          </Frame>
        ),
      },
      {
        title: 'Dano e armadura',
        body: (
          <>
            O dano passa pela <b>SP</b> da armadura (e a desgasta em 1 quando fura). Tiro mirado na cabeça: −8 para acertar, dano que passar é <b>dobrado</b>. Dois 6 nos dados de
            dano = <b>Ferimento Crítico</b>. Armas brancas ignoram metade da SP.
          </>
        ),
        visual: (
          <Frame>
            <p className="tabular text-muted">Dano 3d6 [6, 5, 2] = 13 − SP 7 = 6 → <span className="text-danger">6 PV</span></p>
            <p className="tabular text-muted">Na cabeça: 13 − SP 4 = 9 ×2 → <span className="text-danger">18 PV</span></p>
          </Frame>
        ),
      },
      {
        title: 'Briga: agarrar e o que vem depois',
        body: (
          <>
            Colado no inimigo, use <b>Agarrar</b> (DEX + Briga contra o dele; vocês dois ficam com −2). Agarrado, ele pode ser <b>estrangulado</b> (seu CORPO direto nos PV — 3
            rodadas e ele apaga), <b>arremessado</b> no chão ou usado como <b>escudo humano</b> contra tiros.
          </>
        ),
        visual: (
          <Frame>
            <div className="flex flex-wrap gap-1">
              <Chip icon={<Hand className="w-3 h-3" />} tone="yellow">Agarrar</Chip>
              <Chip tone="danger">Estrangular</Chip>
              <Chip tone="yellow">Arremessar</Chip>
              <Chip>Escudo humano</Chip>
              <Chip tone="green">Soltar</Chip>
            </div>
          </Frame>
        ),
      },
      {
        title: 'Rendidos, caídos e execuções',
        body: (
          <>
            Inimigo caído, rendido ou amarrado pode ser <b>executado</b> sem rolagem (“atiro na cabeça do segurança rendido”). O mesmo vale para você: capturado desde o turno
            anterior, uma arma na cabeça é fatal — reaja enquanto pode.
          </>
        ),
      },
    ],
  },

  role: {
    id: 'role',
    title: 'Habilidade de Papel',
    steps: [
      {
        title: 'O que só o seu papel faz',
        body: (
          <>
            Cada papel do Cyberpunk RED tem uma habilidade própria, com <b>rank</b> de 1 a 10 (você começa no 4). Suba de rank gastando PM: custa <b>60 × o novo rank</b>.
          </>
        ),
        visual: (
          <Frame>
            <p className="eyebrow">Habilidade de Papel</p>
            <div className="flex items-center justify-between">
              <span className="font-display uppercase tracking-wider text-neon-yellow">Consciência de Combate</span>
              <span className="tabular text-2xl">4</span>
            </div>
          </Frame>
        ),
      },
      {
        title: 'Pontos para distribuir',
        body: (
          <>
            <b>Solo</b>, <b>Técnico</b> e <b>Medicânico</b> distribuem pontos entre especialidades nesta aba (o motor aplica os bônus sozinho). <b>Trilheiro</b> usa o rank na
            Rede; <b>Canal</b> ganha desconto e bônus em trabalhos; <b>Nômade</b> soma o rank na direção e tem o veículo do clã.
          </>
        ),
        visual: (
          <Frame>
            <Roll parts="Ataque Preciso (3 pts)" total={1} dv="bônus" ok />
            <Roll parts="Reação de Iniciativa (1 pt)" total={1} dv="bônus" ok />
            <p className="text-dim">Solo: não dá para redistribuir no meio de um combate.</p>
          </Frame>
        ),
      },
    ],
  },

  humanity: {
    id: 'humanity',
    title: 'Humanidade',
    steps: [
      {
        title: 'O cromo cobra seu preço',
        body: (
          <>
            Sua <b>Humanidade</b> caiu. Ela é EMP × 10; cada implante e cada trauma sério tira pontos, e a cada 10 perdidos sua Empatia cai. Conforme ela desce, a narração muda:
            dissociação, pensamentos intrusivos, surtos.
          </>
        ),
        visual: (
          <Frame>
            {[
              ['Estável', 60, '#a855f7'],
              ['Dissociação', 30, '#ff003c'],
              ['Desgaste', 15, '#ff003c'],
              ['À beira', 6, '#ff003c'],
            ].map(([label, v, tone]) => (
              <div key={label as string} className="space-y-0.5">
                <div className="flex justify-between">
                  <span>{label}</span>
                  <span className="tabular text-dim">{v}</span>
                </div>
                <Bar value={v as number} max={60} tone={tone as string} />
              </div>
            ))}
          </Frame>
        ),
      },
      {
        title: 'Zero: ciberpsicose',
        body: (
          <>
            Em 0 você <b>perde o controle</b>: não dá mais para digitar — só escolher entre impulsos de um ciberpsicopata, e o mundo reage (NCPD, MaxTac). Previna com{' '}
            <b>terapia</b> (€$500 = 2d6 · €$1000 = 4d6, uma semana) e pensando bem antes de cada implante: cada peça também baixa o seu máximo.
          </>
        ),
        visual: (
          <Frame className="border-danger/60 bg-danger/10">
            <p className="flex items-center gap-2 font-display uppercase tracking-[0.3em] text-danger">
              <Skull className="w-3.5 h-3.5" /> Controle perdido
            </p>
            <p className="border border-danger/50 px-2 py-1">ATACAR quem estiver mais perto</p>
            <p className="border border-danger/50 px-2 py-1">Fugir pelos telhados — eles estão vindo</p>
          </Frame>
        ),
      },
    ],
  },

  cyber: {
    id: 'cyber',
    title: 'Cromo',
    steps: [
      {
        title: 'O catálogo do ripperdoc',
        body: (
          <>
            O <b>catálogo</b> tem o cromo de 2077: preço (já com a cirurgia), <b>tier</b> (T1 Comum → T5 Lendário), fabricante e quanto de <b>Humanidade</b> custa. Cada
            ripperdoc só instala até o nível da clínica dele; cromo <b>militar</b> só no mercado negro, para quem ele confia; <b>protótipos</b> só achando a peça.
          </>
        ),
        visual: (
          <Frame>
            <div className="flex justify-between">
              <span className="text-fg">Sandevistan "Falcon"</span>
              <span className="tabular text-neon-yellow">€$9000</span>
            </div>
            <p className="text-neon-purple">T4 Épico · Militar · Militech</p>
            <p className="tabular text-neon-purple">HUM −3d6 (~10, máx −2)</p>
            <p className="text-dim">3 rodadas de tempo dilatado: ataque extra, esquiva de balas.</p>
          </Frame>
        ),
      },
      {
        title: 'Fundações e slots',
        body: (
          <>
            Opções precisam de uma <b>fundação</b>: Neural Link (5 slots), Ciberolho (3), Suíte de Ciberáudio (3), Ciberbraço (4), Ciberperna (3). Itens de <b>par</b> vão nos
            dois olhos ou nas duas pernas (preço e Humanidade em dobro). Só cabe uma <b>speedware</b>.
          </>
        ),
        visual: (
          <Frame>
            <p className="text-fg">Ciberbraço <span className="tabular text-neon-cyan">Slots 3/4</span></p>
            <p className="pl-3 text-muted">↳ Wolvers (1) · Pistola Popup (2)</p>
          </Frame>
        ),
      },
      {
        title: 'O preço de verdade',
        body: (
          <>
            Cada implante tira Humanidade (dados rolados) e ainda baixa o seu <b>máximo</b> em 2 (Borgware 4). Lâminas e armas embutidas aparecem no inventário como{' '}
            <b>implante</b> (ninguém te desarma); pele blindada vira armadura permanente. Remover devolve o máximo — a Humanidade perdida só volta com terapia.
          </>
        ),
      },
    ],
  },

  sandbox: {
    id: 'sandbox',
    title: 'Sandbox',
    steps: [
      {
        title: 'Laboratório de mecânicas',
        body: (
          <>
            Personagem de testes com tudo no máximo. O painel <b>Sandbox</b> (menu ☰) mexe em qualquer coisa na hora: papel, rank, atributos, PV, Humanidade, condições, inimigos
            por ficha pronta, Rede e até o próximo d10. Pelo texto também vale: “gera 3 gangers da Maelstrom”.
          </>
        ),
        visual: (
          <Frame>
            <div className="flex flex-wrap gap-1">
              <Chip tone="danger">Gerar Ganger ×3</Chip>
              <Chip icon={<Radar className="w-3 h-3" />}>Criar arquitetura</Chip>
              <Chip tone="magenta">Ciberpsicose (0)</Chip>
              <Chip tone="yellow">d10 = 10</Chip>
            </div>
          </Frame>
        ),
      },
    ],
  },
};
