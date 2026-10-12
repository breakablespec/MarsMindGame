import { newColony } from '../src/sim/init';
import { simulate } from '../src/sim/tick';
import { coreMinute } from '../src/ai/autonomy';
for (const seed of [1, 2, 3, 7, 11, 42]) {
  const st = newColony(seed);
  simulate(st, 1440 * 8, { onMinute: coreMinute });
  console.log(`seed ${seed}: SOL ${Math.floor(st.minute / 1440) + 1} pop ${st.colonists.filter((c) => !c.dead).length} deaths ${st.deaths} stage ${st.stage} o2 ${st.o2.toFixed(0)} water ${st.water.toFixed(0)} rations ${st.rations} lost ${st.lost} alerts ${st.alerts.filter((a) => !a.resolved).map((a) => a.title).join('; ')}`);
}
