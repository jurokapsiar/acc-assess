// --setup module that declares a non-fresh isolation and records an intervention.
export const isolation = 'reused-page';

export async function beforeTarget({ target }) {
  target.addIntervention({ step: 0, kind: 'setup-click', reason: 'dismissed a startup banner' });
}
