export const gnPage =
  '<c-wiz><div jscontroller="x" data-n-a-id="CBMiAAA" data-n-a-ts="1759680000" data-n-a-sg="SIG_abc"></div></c-wiz>'
export const batchResponse = (urls: string[]) =>
  `)]}'\n\n${JSON.stringify([
    ...urls.map((u) => [
      'wrb.fr',
      'Fbv4je',
      JSON.stringify(['garturlres', u, 1]),
      null,
      null,
      null,
      'generic',
    ]),
    ['di', 42],
    ['af.httprm', 41, '-1', 7],
  ])}`
