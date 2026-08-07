import { Szene3D } from '../scene/Szene3D.tsx';
import { Karte2D } from '../map2d/Karte2D.tsx';
import { Werkzeugleiste } from './Werkzeugleiste.tsx';
import { Seitenpanel } from '../panels/Seitenpanel.tsx';
import { nutzeZustand } from '../lib/zustand.ts';

export function Arbeitsflaeche() {
  const ansicht = nutzeZustand((s) => s.ansicht);
  const laedt = nutzeZustand((s) => s.laedt);

  return (
    <div className="arbeitsflaeche">
      <Werkzeugleiste />
      <div className="buehne" data-ansicht={ansicht}>
        {laedt && <div className="laedt-balken" />}
        {(ansicht === '3d' || ansicht === 'geteilt') && (
          <div className="buehne-teil">
            <Szene3D sichtbar={ansicht === '3d' || ansicht === 'geteilt'} />
          </div>
        )}
        {(ansicht === '2d' || ansicht === 'geteilt') && (
          <div className="buehne-teil">
            <Karte2D sichtbar={ansicht === '2d' || ansicht === 'geteilt'} />
          </div>
        )}
      </div>
      <Seitenpanel />
    </div>
  );
}
