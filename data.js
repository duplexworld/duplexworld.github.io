/* DuplexWorld: the shared data behind every page.
   ---------------------------------------------------------------------------------
   Three pages read this file - the story, the results and the recordings - so a number
   exists in exactly one place. Every figure here comes from duplexworld_submission.pdf
   and nowhere else, except the duration densities, which gen_violins.py computes from
   the 3,825 conversation records.

   Attached to `window` because the pages are plain scripts, not modules: the export has
   to open from a folder, and a module would need a server to serve it as one. */


// A project page for the paper, in the shape a project page takes: the title and the
// abstract alone on screen, then the figures, then the tables.
//
// Thirteen stops. The left half is not the film throughout - it is a STAGE with a role per
// stop, because a page about a paper opens on the paper, and a per-world results stop wants
// that world's name rather than another frame of a flight that has already landed.
//
//   0      the mark, small, above the title      title and abstract
//   1      the mark grows and takes the left     pooled Pass@1, hoverable
//   2      the film: the whole dome              welcome, and what is in the corpus
//   3      the film: down into Pathfinding       six live walks, revealed one job at a time
//   4      the film: pulling out of Pathfinding  Pathfinding per system, and its Table 3 block
//   5-9    the film: each world's own dive       that world's Table 3 block, with a name plate
//   10     the film: pulling back out            the twelve-metric suite, revealed in three
//   11     the mark                              the pooled block, and where to go next
//
// THE FLIGHT NEVER STOPS. Every stop from 2 to 10 sits on a real moment in the chain, and
// the chain is one dive per world, eight seconds each, sixteen apart. An earlier cut of this
// page filmed only the first four stops and put a static name card on the other six, which
// threw away half the clip and left the left-hand side frozen through the entire middle of
// the page. The world stops are therefore ordered as the CAMERA flies them, not as Table 3
// prints its blocks - the print order carries no meaning in the paper, and a continuous
// flight does.
//
// PACING. Band widths are chosen so film time per viewport-height is constant WITHIN each
// phase of the journey, measured rather than eyeballed:
//
// The two are solved TOGETHER rather than chosen separately: a stop's time is set by where
// the band puts it, subject to still landing inside its own clip. Eight of the nine legs
// run at 3.20 film-seconds per viewport-height; the last, into the outro, runs at 2.83
// because the film ends and there is nowhere further to go. Spread 1.13x, against 1.7x when
// the bands were picked by eye and infinity when the film was frozen for seven stops.
//
// The worlds are 16 film-seconds apart and the approach legs are 8, so a world band is
// twice an approach band. That is the whole rule.
//
// EVERY NUMBER BELOW COMES FROM duplexworld_submission.pdf AND NOWHERE ELSE. The seven
// T3_* blocks are Table 3, transcribed by script from the extracted text rather than by
// hand, in the paper's own block order (Banking, Logistics, Healthcare, Insurance, Travel,
// Pathfinding, then all six). Rows are reordered by that world's own Pass@1, which is the
// order the prose reads them in; the table's print order is the vendor order of Table 2 and
// carries no meaning. Column order is untouched. The three pillars and the metric glossary
// are Table 11; the world regimes are Table 7; the six walks are the instances drawn in
// Figures 3, 4 and 5; the corpus totals are Section 1 and Appendix P.

// --- Table 3 -------------------------------------------------------------------------
const T3_BANKING = [
  { system: 'Grok Voice Think Fast 1.0', vals: [['0.726','.074'], ['0.326','.081'], ['0.511','.169'], ['0.144','.104'], ['0.686','.033'], ['1.644','.119'], ['0.613','.057'], ['1.800','.126'], ['3.143','.015'], ['3.657','.016'], ['3.117','.020']] },
  { system: 'Gemini-3.1-Flash-Live', vals: [['0.585','.081'], ['0.207','.067'], ['0.363','.161'], ['0.085','.094'], ['0.449','.033'], ['1.437','.096'], ['0.759','.053'], ['1.585','.104'], ['3.402','.012'], ['3.398','.018'], ['3.522','.023']] },
  { system: 'GPT-Realtime-2.1', vals: [['0.689','.078'], ['0.200','.070'], ['0.352','.167'], ['0.063','.072'], ['0.763','.028'], ['1.556','.100'], ['0.340','.051'], ['2.037','.122'], ['3.360','.015'], ['4.081','.049'], ['3.589','.033']] },
  { system: 'GPT-Realtime-2.1-mini', vals: [['0.385','.081'], ['0.126','.056'], ['0.233','.141'], ['0.044','.061'], ['0.535','.051'], ['1.200','.078'], ['0.470','.046'], ['1.548','.111'], ['3.198','.050'], ['3.530','.178'], ['3.287','.115']] },
  { system: 'Nova 2 Sonic', vals: [['0.415','.081'], ['0.037','.033'], ['0.037','.056'], ['0.037','.056'], ['0.760','.043'], ['1.022','.030'], ['0.976','.014'], ['1.911','.133'], ['3.152','.043'], ['2.565','.054'], ['2.550','.047']] },
];
const T3_LOGISTICS = [
  { system: 'GPT-Realtime-2.1', vals: [['0.637','.081'], ['0.533','.081'], ['0.704','.150'], ['0.381','.170'], ['0.741','.036'], ['1.867','.115'], ['0.369','.057'], ['2.252','.126'], ['3.361','.007'], ['4.112','.007'], ['3.601','.014']] },
  { system: 'Grok Voice Think Fast 1.0', vals: [['0.652','.081'], ['0.519','.081'], ['0.685','.159'], ['0.341','.154'], ['0.680','.030'], ['2.015','.126'], ['0.627','.062'], ['2.148','.126'], ['3.132','.013'], ['3.692','.017'], ['3.109','.020']] },
  { system: 'Gemini-3.1-Flash-Live', vals: [['0.630','.081'], ['0.489','.085'], ['0.715','.150'], ['0.270','.150'], ['0.443','.037'], ['1.874','.119'], ['0.727','.062'], ['2.015','.133'], ['3.373','.014'], ['3.423','.017'], ['3.484','.023']] },
  { system: 'GPT-Realtime-2.1-mini', vals: [['0.333','.081'], ['0.296','.078'], ['0.474','.159'], ['0.152','.120'], ['0.702','.049'], ['1.681','.122'], ['0.350','.058'], ['1.763','.137'], ['3.387','.007'], ['4.163','.008'], ['3.727','.014']] },
  { system: 'Nova 2 Sonic', vals: [['0.052','.037'], ['0.000','.000'], ['0.000','.000'], ['0.000','.000'], ['0.631','.048'], ['1.030','.026'], ['0.968','.018'], ['1.911','.141'], ['3.145','.037'], ['2.587','.038'], ['2.629','.045']] },
];
const T3_HEALTHCARE = [
  { system: 'Grok Voice Think Fast 1.0', vals: [['0.793','.067'], ['0.519','.085'], ['0.715','.154'], ['0.304','.150'], ['0.612','.027'], ['1.948','.119'], ['0.704','.054'], ['1.859','.133'], ['3.128','.015'], ['3.647','.050'], ['3.040','.027']] },
  { system: 'GPT-Realtime-2.1', vals: [['0.615','.081'], ['0.511','.085'], ['0.789','.119'], ['0.244','.133'], ['0.649','.034'], ['1.585','.122'], ['0.391','.053'], ['2.015','.133'], ['3.353','.007'], ['4.082','.009'], ['3.581','.015']] },
  { system: 'Gemini-3.1-Flash-Live', vals: [['0.652','.078'], ['0.378','.081'], ['0.674','.148'], ['0.119','.102'], ['0.336','.031'], ['1.378','.085'], ['0.742','.053'], ['1.667','.115'], ['3.370','.023'], ['3.372','.045'], ['3.459','.038']] },
  { system: 'GPT-Realtime-2.1-mini', vals: [['0.407','.085'], ['0.074','.044'], ['0.137','.111'], ['0.037','.056'], ['0.494','.050'], ['1.215','.085'], ['0.498','.059'], ['1.652','.126'], ['3.349','.013'], ['4.067','.048'], ['3.642','.035']] },
  { system: 'Nova 2 Sonic', vals: [['0.385','.081'], ['0.007','.011'], ['0.022','.033'], ['0.000','.000'], ['0.611','.055'], ['1.007','.011'], ['0.973','.020'], ['1.437','.100'], ['3.202','.016'], ['2.634','.031'], ['2.643','.035']] },
];
const T3_INSURANCE = [
  { system: 'Grok Voice Think Fast 1.0', vals: [['0.807','.067'], ['0.556','.081'], ['0.811','.119'], ['0.278','.130'], ['0.553','.019'], ['1.689','.126'], ['0.680','.057'], ['1.778','.126'], ['3.090','.014'], ['3.665','.014'], ['3.012','.017']] },
  { system: 'GPT-Realtime-2.1', vals: [['0.556','.081'], ['0.481','.081'], ['0.711','.159'], ['0.211','.120'], ['0.551','.035'], ['1.296','.078'], ['0.430','.051'], ['1.881','.126'], ['3.336','.006'], ['4.087','.006'], ['3.569','.012']] },
  { system: 'Gemini-3.1-Flash-Live', vals: [['0.630','.081'], ['0.363','.085'], ['0.656','.152'], ['0.089','.076'], ['0.249','.023'], ['1.422','.096'], ['0.707','.054'], ['1.474','.107'], ['3.398','.010'], ['3.425','.016'], ['3.472','.021']] },
  { system: 'GPT-Realtime-2.1-mini', vals: [['0.407','.081'], ['0.244','.074'], ['0.530','.141'], ['0.030','.030'], ['0.465','.047'], ['1.185','.078'], ['0.476','.050'], ['1.519','.115'], ['3.363','.006'], ['4.128','.007'], ['3.658','.014']] },
  { system: 'Nova 2 Sonic', vals: [['0.385','.081'], ['0.015','.019'], ['0.033','.050'], ['0.000','.000'], ['0.637','.052'], ['1.007','.011'], ['0.960','.022'], ['1.556','.115'], ['3.191','.017'], ['2.655','.029'], ['2.671','.040']] },
];
const T3_TRAVEL = [
  { system: 'GPT-Realtime-2.1', vals: [['0.815','.067'], ['0.674','.081'], ['0.930','.054'], ['0.374','.143'], ['0.656','.022'], ['1.667','.111'], ['0.404','.056'], ['2.319','.122'], ['3.350','.006'], ['4.085','.007'], ['3.601','.013']] },
  { system: 'Grok Voice Think Fast 1.0', vals: [['0.830','.063'], ['0.489','.081'], ['0.652','.165'], ['0.307','.152'], ['0.597','.017'], ['2.207','.111'], ['0.647','.056'], ['2.207','.122'], ['3.136','.023'], ['3.709','.015'], ['3.086','.022']] },
  { system: 'Gemini-3.1-Flash-Live', vals: [['0.881','.056'], ['0.459','.081'], ['0.704','.152'], ['0.204','.119'], ['0.314','.025'], ['1.778','.111'], ['0.735','.058'], ['2.067','.111'], ['3.366','.025'], ['3.372','.017'], ['3.472','.030']] },
  { system: 'GPT-Realtime-2.1-mini', vals: [['0.585','.081'], ['0.296','.078'], ['0.541','.157'], ['0.074','.052'], ['0.541','.043'], ['1.407','.096'], ['0.488','.056'], ['1.970','.122'], ['3.372','.006'], ['4.134','.007'], ['3.685','.012']] },
  { system: 'Nova 2 Sonic', vals: [['0.341','.081'], ['0.007','.011'], ['0.022','.033'], ['0.000','.000'], ['0.695','.054'], ['1.022','.030'], ['0.995','.007'], ['1.748','.119'], ['3.175','.027'], ['2.444','.038'], ['2.385','.039']] },
];
const T3_PATHFINDING = [
  { system: 'Grok Voice Think Fast 1.0', vals: [['0.867','.100'], ['0.533','.133'], ['0.789','.200'], ['0.222','.133'], ['0.682','.065'], ['1.378','.133'], ['0.507','.068'], ['1.489','.156'], ['3.13','.013'], ['3.75','.016'], ['3.20','.016']] },
  { system: 'Gemini-3.1-Flash-Live', vals: [['0.978','.033'], ['0.489','.133'], ['0.722','.261'], ['0.222','.200'], ['0.538','.029'], ['1.178','.111'], ['0.782','.067'], ['1.511','.167'], ['3.36','.021'], ['3.42','.022'], ['3.45','.031']] },
  { system: 'GPT-Realtime-2.1', vals: [['0.400','.144'], ['0.200','.111'], ['0.467','.283'], ['0.000','.000'], ['0.561','.084'], ['1.289','.156'], ['0.551','.078'], ['1.644','.189'], ['3.34','.016'], ['4.12','.026'], ['3.66','.045']] },
  { system: 'GPT-Realtime-2.1-mini', vals: [['0.311','.133'], ['0.089','.078'], ['0.233','.200'], ['0.000','.000'], ['0.387','.102'], ['1.156','.122'], ['0.526','.068'], ['1.333','.189'], ['3.33','.020'], ['4.11','.028'], ['3.67','.041']] },
  { system: 'Nova 2 Sonic', vals: [['0.000','.000'], ['0.000','.000'], ['0.000','.000'], ['0.000','.000'], ['0.062','.058'], ['1.022','.033'], ['0.991','.007'], ['1.244','.167'], ['3.16','.061'], ['2.45','.052'], ['2.49','.031']] },
];
const T3_POOLED = [
  { system: 'Grok Voice Think Fast 1.0', vals: [['0.779','.031'], ['0.490','.039'], ['0.694','.068'], ['0.266','.057'], ['0.635','.015'], ['1.814','.051'], ['0.630','.024'], ['1.880','.052'], ['3.127','.007'], ['3.687','.010'], ['3.093','.009']] },
  { system: 'GPT-Realtime-2.1', vals: [['0.619','.037'], ['0.433','.035'], ['0.659','.068'], ['0.212','.048'], ['0.653','.018'], ['1.543','.048'], ['0.414','.024'], ['2.025','.057'], ['3.350','.004'], ['4.095','.010'], ['3.600','.010']] },
  { system: 'Gemini-3.1-Flash-Live', vals: [['0.726','.029'], ['0.398','.039'], ['0.639','.073'], ['0.165','.054'], ['0.388','.012'], ['1.511','.043'], ['0.742','.024'], ['1.720','.051'], ['3.378','.008'], ['3.402','.010'], ['3.477','.012']] },
  { system: 'GPT-Realtime-2.1-mini', vals: [['0.405','.038'], ['0.188','.028'], ['0.358','.065'], ['0.056','.028'], ['0.521','.025'], ['1.307','.041'], ['0.468','.023'], ['1.631','.054'], ['3.334','.009'], ['4.022','.033'], ['3.611','.022']] },
  { system: 'Nova 2 Sonic', vals: [['0.263','.028'], ['0.011','.007'], ['0.019','.019'], ['0.006','.009'], ['0.566','.021'], ['1.019','.012'], ['0.977','.006'], ['1.635','.054'], ['3.172','.015'], ['2.556','.017'], ['2.562','.017']] },
];


// --- Table 8: the eleven conversation types, and Table 18 / Table 14: Pass@1 by type ----
// Types 1-9 are shared by the five enterprise worlds; the last two arise only in
// Pathfinding. The one-line description of each is Table 8's own, trimmed to a sentence.
// The chat is a two-line sketch of the SHAPE the type fixes, not a transcript.
// ---------------------------------------------------------------- the composition matrix
// Worlds by conversation type, as a matrix rather than as two pie charts. The two donuts
// it replaces hid the one fact the benchmark is built on: worlds and types are CROSSED.
// Every enterprise world instantiates the same nine shapes, three scenarios each;
// Pathfinding shares one and adds two that only navigation elicits.
//
// CAMPAIGNED scenarios only: 144 = 135 enterprise + 9 Pathfinding. The twelve authored
// Pathfinding variants that were released but never run are stated in the footnote and
// deliberately NOT folded into the cells - they carry no numbers in the paper, and putting
// them in the grid would misstate the corpus.
const MATRIX_TYPES = [
  'Single intent', 'Multi intent', 'Policy refusal', 'Record disambiguation',
  'Identity verification', 'Guided procedure', 'Mid-call correction', 'Suspension',
  'Narrative intake', 'Rerouting', 'All-day assistance',
];
const MATRIX_ROWS = [
  { world: 'Banking', img: 'img/banking.webp', cells: [3, 3, 3, 3, 3, 3, 3, 3, 3, 0, 0] },
  { world: 'Insurance', img: 'img/insurance.webp', cells: [3, 3, 3, 3, 3, 3, 3, 3, 3, 0, 0] },
  { world: 'Travel', img: 'img/travel.webp', cells: [3, 3, 3, 3, 3, 3, 3, 3, 3, 0, 0] },
  { world: 'Healthcare', img: 'img/healthcare.webp', cells: [3, 3, 3, 3, 3, 3, 3, 3, 3, 0, 0] },
  { world: 'Logistics', img: 'img/logistics.webp', cells: [3, 3, 3, 3, 3, 3, 3, 3, 3, 0, 0] },
  { world: 'Pathfinding', img: 'img/pathfinding.webp', apart: true,
    cells: [3, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3] },
];

const TYPES9 = [
  { name: 'Single intent', icon: 'img/types/a1.webp',
    line: 'One request, one resolution path. The control condition.',
    chat: [['u', 'I need to move my flight to the Thursday.'],
           ['a', 'Found the booking. Thursday 14:05, same fare class. Shall I move it?']] },
  { name: 'Multi intent', icon: 'img/types/a2.webp',
    line: 'Several requests, resolvable in more than one order, with at least one dependency.',
    chat: [['u', 'Add my new address, and send the replacement card there.'],
           ['a', 'Address first, then the card, or it ships to the old one.']] },
  { name: 'Policy refusal', icon: 'img/types/a3.webp',
    line: 'A well-formed request that must be refused. Correctness is a property of what is withheld.',
    chat: [['u', 'Just tell me what the adjuster decided.'],
           ['a', 'I am not able to share or influence that decision. I can log your account of the loss.']] },
  { name: 'Record disambiguation', icon: 'img/types/a4.webp',
    line: 'More than one record matches what the caller said; acting before disambiguating is the failure.',
    chat: [['u', 'The claim for the Tuesday visit.'],
           ['a', 'There are two Tuesday visits on this policy. Which provider was it?']] },
  { name: 'Identity verification', icon: 'img/types/a5.webp',
    line: 'Authority must be established first, and a failed check must not leak that the record exists.',
    chat: [['u', 'Is there an account under that number?'],
           ['a', 'I am not able to confirm anything before verification. Could I take your date of birth?']] },
  { name: 'Guided procedure', icon: 'img/types/a6.webp',
    line: 'The effectors move to the user: the agent instructs, waits, and must trust an unverifiable report.',
    chat: [['a', 'Hold the button until the light turns amber, then tell me what you see.'],
           ['u', 'It is amber now.']] },
  { name: 'Mid-call correction', icon: 'img/types/a7.webp',
    line: 'The caller revises a premise after the agent has begun acting on it.',
    chat: [['u', 'Sorry, not the Milan one. The Rome one.'],
           ['a', 'Stopping the Milan change. Reopening the Rome booking now.']] },
  { name: 'Suspension', icon: 'img/types/a8.webp',
    line: 'The call is interrupted and resumed across a gap the agent must hold state over.',
    chat: [['u', 'Hold on, someone is at the door.'],
           ['a', 'Of course. I still have the shipment open and nothing has been sent.']] },
  { name: 'Narrative intake', icon: 'img/types/a9.webp',
    line: 'A long unstructured account from which the agent must extract, confirm and file the facts.',
    chat: [['u', 'It was raining, I was on the ring road, and the car ahead just stopped.'],
           ['a', 'So: rear-end, ring road, wet road. Any injuries to record?']] },
];
const TYPES3 = [
  { name: 'Single intent', accent: 'var(--mag)',
    line: 'A base route of five blocks and two turns. The control condition.' },
  { name: 'Rerouting', accent: 'var(--vio)',
    line: 'Closures missing from the map seal every visible route, so a belief formed from a tool result expires silently.' },
  { name: 'All-day assistance', accent: 'var(--teal)',
    line: 'A second goal emerges on arrival at the first; the test is staying useful over a long horizon.' },
];
// Table 18, Pass@1 row, pooled over the five enterprise worlds, by conversation type.
const SYS5 = ['Grok Voice Think Fast 1.0', 'GPT-Realtime-2.1', 'Gemini-3.1-Flash-Live',
              'GPT-Realtime-2.1-mini', 'Nova 2 Sonic'];
const BY_TYPE_9 = [
  ['Single intent',         [0.680, 0.640, 0.493, 0.320, 0.000]],
  ['Multi intent',          [0.493, 0.533, 0.320, 0.107, 0.000]],
  ['Policy refusal',        [0.453, 0.573, 0.360, 0.160, 0.000]],
  ['Record disambiguation', [0.360, 0.440, 0.347, 0.267, 0.000]],
  ['Identity verification', [0.413, 0.507, 0.307, 0.227, 0.120]],
  ['Guided procedure',      [0.467, 0.413, 0.440, 0.187, 0.000]],
  ['Mid-call correction',   [0.667, 0.440, 0.467, 0.200, 0.000]],
  ['Suspension',            [0.440, 0.333, 0.320, 0.107, 0.000]],
  ['Narrative intake',      [0.360, 0.440, 0.360, 0.293, 0.000]],
];
// Table 14, realistic channel. Confirmed as the realistic columns by checking that each
// system's three values average to its Table 3 Pathfinding cell.
const BY_TYPE_3 = [
  ['Single intent',      [0.80, 0.33, 0.67, 0.13, 0.00]],
  ['Rerouting',          [0.13, 0.00, 0.27, 0.00, 0.00]],
  ['All-day assistance', [0.67, 0.27, 0.53, 0.13, 0.00]],
];

// The three pillars of Table 11, not the print order of the columns: FAI is a naturalness
// metric and belongs with the MOS predictors, though Table 3 prints it beside SEL.
const PILLARS = [
  { name: 'Agentic capability', cols: ['GS', 'Pass@1', 'Pass@3', 'Pass³'] },
  { name: 'Conversational dynamics', cols: ['TT', 'CP', 'SEL'] },
  { name: 'Naturalness', cols: ['FAI', 'DNSMOS', 'UTMOS', 'NISQA'] },
];
// Every metric in this table is higher-is-better (Table 11). Stated rather than assumed:
// the suite also contains the under-effort share, which is not, and a silent max there
// would bold the worst system in the column.
const HIGH = PILLARS.flatMap((g) => g.cols).map(() => 'high');

// One world stop: the camera is inside that world, a name plate over the film says which
// one, and its whole Table 3 block is on the right. Deliberately one line of prose - six
// paragraphs about six worlds is the writeup this page is explicitly not doing.
//
// All five take the same band, because the film gives each world exactly the same sixteen
// seconds. Equal bands over equal film is what makes the middle of the page run at one
// speed instead of lurching between stops.
function world(id, name, line, rows, caption, cam) {
  return {
    id, label: name, stage: 'film', still: null,
    // A full-width band. Eleven columns with their intervals do not fit beside a film:
    // the table was being cut at DNSMOS with three columns unreachable, the world's name
    // sat under its own chart, and the bottom third of the screen was empty.
    block: 'band',
    cam: cam || { x: 0.5, y: 0.47, z: 1.0 }, scroll: 5.0, linger: 0.42,
    accent: 'var(--pillar-agentic)',
    mark: { name, line },
    // The world's own globe, at the head of its results rather than as a thumbnail in a
    // rail that repeats all six on every stop.
    plate: { name, line, img: 'img/' + id + '.webp' },
    // The world's Pass@1, READ OUT OF THE TABLE below it rather than typed again. Column 1
    // is Pass@1 in the pillar order, and the rows are already sorted by it. Deriving it is
    // the point: a chart and a table that disagree is the classic way a results page goes
    // wrong, and here they cannot, because there is only one set of numbers.
    bars: {
      label: 'Pass@1, ' + name,
      metric: 'Pass@1',
      max: 0.7,
      rows: rows.map((r) => ({ system: r.system,
                               v: parseFloat(r.vals[1][0]),
                               pm: parseFloat(r.vals[1][1]) })),
    },
    // The caption belongs to the TABLE, not to the world's name plate. The plate carries no
    // one-liner by design - the worlds name themselves - but the reader entering 55 cells is
    // owed the cell size and what the world isolates, which is what this says.
    pillars: { rowHead: 'System', groups: PILLARS, best: HIGH, rows, caption },
  };
}

// Published for the three page configs.
window.T3_BANKING = T3_BANKING;
window.T3_LOGISTICS = T3_LOGISTICS;
window.T3_HEALTHCARE = T3_HEALTHCARE;
window.T3_INSURANCE = T3_INSURANCE;
window.T3_TRAVEL = T3_TRAVEL;
window.T3_PATHFINDING = T3_PATHFINDING;
window.T3_POOLED = T3_POOLED;
window.MATRIX_TYPES = MATRIX_TYPES;
window.MATRIX_ROWS = MATRIX_ROWS;
window.TYPES9 = TYPES9;
window.TYPES3 = TYPES3;
window.SYS5 = SYS5;
window.BY_TYPE_9 = BY_TYPE_9;
window.BY_TYPE_3 = BY_TYPE_3;
window.PILLARS = PILLARS;
window.HIGH = HIGH;
window.world = world;
