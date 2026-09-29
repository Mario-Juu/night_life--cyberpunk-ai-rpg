import { DV_TABLE } from '@shared/rules/difficulty';
import { CRITICAL_INJURIES } from '@shared/rules/criticalInjuries';
import { RANGED_BRACKETS, WEAPONS } from '@shared/rules/weapons';
import { Modal } from '../../ui';
import { useUiStore } from '../../store/uiStore';

const RANGED = Object.values(WEAPONS).filter(w => w.dvs);

export function RulesModal() {
  const open = useUiStore(s => s.modal === 'rules');
  const close = () => useUiStore.getState().openModal(null);
  return (
    <Modal open={open} onClose={close} title="Regras de referência" subtitle="Cyberpunk RED, como o motor deste jogo as aplica." size="lg">
      <div className="space-y-6 text-sm">
        <section className="space-y-2">
          <h3 className="font-display text-xs uppercase tracking-wider text-neon-cyan">Testes</h3>
          <p className="text-muted">
            ATRIBUTO + PERÍCIA + 1d10 + modificadores. É preciso <strong className="text-fg">superar</strong> o DV (empate favorece a dificuldade). Um 10 natural rola
            outro d10 e soma; um 1 natural rola outro d10 e subtrai. Pontos de Sorte somam +1 cada e recarregam na virada do dia.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {DV_TABLE.map(d => (
              <div key={d.dv} className="border border-line p-2">
                <p className="tabular text-neon-yellow">DV {d.dv}</p>
                <p className="text-xs text-fg">{d.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-display text-xs uppercase tracking-wider text-neon-cyan">Ferimentos</h3>
          <ul className="list-disc pl-5 text-muted space-y-1">
            <li>PV máximo = 10 + 5 × ⌈(CORPO + VONTADE) ÷ 2⌉.</li>
            <li>Abaixo da metade dos PV: <span className="text-neon-yellow">Gravemente ferido</span>, −2 em todas as ações.</li>
            <li>0 PV: <span className="text-danger">Mortalmente ferido</span>, −4 em tudo (−6 em MOVE) e Teste de Morte a cada turno (1d10 + penalidade ≤ CORPO; 10 natural sempre falha). A penalidade sobe 1 a cada teste e +1 por Ferimento Crítico.</li>
            <li>Dano − SP da armadura. Tiros na cabeça dobram o dano que passa. Armas brancas ignoram metade da SP (arredondada para cima); socos e chutes não.</li>
            <li>Desarmado (Briga): dano pelo CORPO — até 4: 1d6 · 5–6: 2d6 · 7–10: 3d6 · 11+: 4d6.</li>
            <li>Armadura pesada: SP 12–13 dá −2 em REF, DEX e MOVE (inclusive iniciativa); SP 15+ dá −4.</li>
            <li>Se o dano passa da armadura, ela perde 1 de SP (ablação).</li>
            <li>Dois ou mais 6 nos dados de dano: ferimento crítico, com +5 de dano direto e uma sequela.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="font-display text-xs uppercase tracking-wider text-neon-cyan">DV de ataque à distância</h3>
          <div className="overflow-x-auto">
            <table className="w-full tabular text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="text-left font-normal py-1 pr-2">Arma</th>
                  {RANGED_BRACKETS.map(b => (
                    <th key={b} className="font-normal px-1.5">
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RANGED.map(w => (
                  <tr key={w.id} className="border-t border-line-soft">
                    <td className="py-1 pr-2 text-fg whitespace-nowrap">
                      {w.label} <span className="text-dim">{w.defaultDamage}</span>
                    </td>
                    {RANGED_BRACKETS.map(b => (
                      <td key={b} className="text-center px-1.5">
                        {w.dvs?.[b] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Corpo a corpo: seu ataque contra a Evasão do alvo (DEX + Evasão + 1d10). Com REF 8 ou mais, você também esquiva de tiros. Mira na cabeça: −8. Meia cobertura: +2 no DV.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-display text-xs uppercase tracking-wider text-neon-cyan">Ferimentos críticos</h3>
          <ul className="grid sm:grid-cols-2 gap-1.5">
            {CRITICAL_INJURIES.map(i => (
              <li key={i.key} className="border border-line-soft p-2">
                <p className="text-xs text-danger">
                  {i.name} <span className="text-dim">({i.location === 'head' ? 'cabeça' : 'corpo'})</span>
                </p>
                <p className="text-[11px] text-muted">{i.effect}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="font-display text-xs uppercase tracking-wider text-neon-cyan">Evolução</h3>
          <p className="text-muted">O Mestre concede Pontos de Melhoria (PM) ao fim de cenas marcantes. Subir uma perícia custa 20 × o novo nível, até o nível 10.</p>
        </section>
      </div>
    </Modal>
  );
}
