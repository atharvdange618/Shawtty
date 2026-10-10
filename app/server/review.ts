// System review pass — the automated QA the pipeline was missing.
//
// Every plan is validated AND auto-repaired here before render:
//   1. AV-sync: narration === join(beats) word-for-word (else visuals lie).
//   2. Readability: beats long enough to see, short enough for one shot.
//   3. Diversity: no repeated visual twice in a row, capped reuse per reel.
//   4. Text safety: headlines/bodies fit their on-screen containers.
//   5. Accent/palette sanity: valid hex, never invisible on background.
//
// Returns the repaired scene list + a list of human-readable warnings that
// are persisted to job.json so the user can see what the reviewer changed.
import { THEME_PALETTES } from './aicredits';
import { MAX_BEAT_WORDS, mergeFlashBeats, normalizeScriptText } from './timeline';
import type { ReelTheme, Scene, TimedBeat, Visual } from '../types';

export type ReviewResult = {
  scenes: Scene[];
  narration: string;
  warnings: string[];
  repaired: boolean;
};

// Visuals that render large headline typography — safe for any topic.
const TYPOGRAPHY_SAFE: Visual[] = ['kinetic_typography', 'quote_card', 'stat_spotlight'];
// Data-dense motion graphics — need real visualData to avoid looking empty.
// split_screen needs 2 elements (two sides); terminal_stream needs a real
// codeSnippet (a code window on a parenting beat is a relevance mismatch).
const DATA_HEAVY: Visual[] = [
  'comparison_matrix',
  'neural_flow',
  'radial_gauge',
  'architecture_stack',
  'terminal_stream',
  'bento_grid',
  'timeline_path',
  'split_screen',
];

// Personal/anecdotal beats ("my sister", "I saw", family words) must render
// as typography or dialogue — never as a data chart or code terminal. This
// is the exact "That's my sister → AGI comparison chart" failure.
const ANECDOTE_RE =
  /(^|\s)(i|my|me|we|our|you'?re? seeing|sister|brother|mom|dad|mummy|papa|mother|father|family|grandma|grandpa|daughter|son|kid\b|my \w+ (is|was|has|had))\b/i;
// Full set the renderer supports (kept in sync with GeneratedReel dispatcher).
const ALL_VISUALS: Visual[] = [
  'kinetic_typography',
  'bento_grid',
  'neural_flow',
  'comparison_matrix',
  'radial_gauge',
  'architecture_stack',
  'terminal_stream',
  'stat_spotlight',
  'timeline_path',
  'dialogue_cards',
  'sticker_collage',
  'split_screen',
  'quote_card',
  'orbit',
  'bars',
  'timeline',
  'cards',
  'pulse',
  'wave_spectrum',
  'landscape_canvas',
  'cinematic_character',
  'character_duo',
  'cinematic_quote',
];

// Per-theme preferred rotation — guarantees a food reel never looks like an
// AGI keynote. The reviewer rotates through these instead of repeating one.
const THEME_ROTATION: Record<ReelTheme, Visual[]> = {
  storytelling: ['cinematic_character', 'kinetic_typography', 'quote_card', 'timeline_path', 'stat_spotlight', 'bento_grid'],
  tech: ['neural_flow', 'terminal_stream', 'kinetic_typography', 'radial_gauge', 'architecture_stack', 'comparison_matrix'],
  education: ['bento_grid', 'kinetic_typography', 'timeline_path', 'comparison_matrix', 'stat_spotlight', 'quote_card'],
  comedy: ['sticker_collage', 'dialogue_cards', 'kinetic_typography', 'quote_card', 'stat_spotlight', 'split_screen'],
  finance: ['comparison_matrix', 'radial_gauge', 'stat_spotlight', 'bento_grid', 'kinetic_typography', 'timeline_path'],
  lifestyle: ['bento_grid', 'kinetic_typography', 'stat_spotlight', 'quote_card', 'split_screen', 'timeline_path'],
};

const isHex = (v: unknown): boolean => /^#[0-9a-f]{6}$/i.test(String(v || ''));

const clampWords = (text: string, maxWords: number): string => {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(' ') : words.join(' ');
};

// Placeholder copy the LLM emits when it has no real data — boxes rendered
// with these read as dead filler ("Key stat", "10x"). The concrete gate
// below rejects them so they get synthesized from the beat or demoted.
const PLACEHOLDER_TEXT = new Set([
  'key stat', 'key factor', 'key result', 'key point', 'key idea', 'key metric',
  'stat', 'metric', 'statistic', 'number', 'value', 'detail', 'item', 'step',
  'point', 'data', 'info', 'factor', 'option', 'alternative', 'baseline',
  'improved', 'before', 'after', 'main point', 'core multiplier', 'core idea',
  '10x', '92%', '100%', '58%', '34%', 'n/a', 'tbd', '...', '-', '',
]);

const isPlaceholder = (text: unknown): boolean =>
  PLACEHOLDER_TEXT.has(String(text || '').replace(/\s+/g, ' ').trim().toLowerCase());

const WORD_NUMBERS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40',
  fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90', hundred: '100',
};

const digitsOf = (text: string): string[] => {
  const out = new Set<string>();
  for (const m of String(text || '').matchAll(/\d+(?:\.\d+)?/g)) {
    out.add(m[0].replace(/^0+(?=\d)/, ''));
  }
  const lower = String(text || '').toLowerCase();
  for (const [word, digit] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) out.add(digit);
  }
  return [...out];
};

/**
 * Number grounding: every digit shown on screen must be SPOKEN in the beat.
 * "83%" with no 83 in the voice is fabrication — the metric, bar, or value
 * is dropped (never rendered). Returns human-readable change notes.
 */
const groundNumbersToBeat = (draft: Scene, beat: string): string[] => {
  const changes: string[] = [];
  const beatDigits = new Set(digitsOf(beat));
  const spoken = (d: string): boolean => beatDigits.has(d.replace(/^0+(?=\d)/, ''));
  const vd = draft.visualData ?? {};

  if (vd.metric) {
    const words = vd.metric.trim().split(/\s+/);
    if (words.length > 5 || vd.metric.trim().length > 22) {
      // A sentence is not a hero number — it truncates on screen.
      if (!vd.metricLabel || isPlaceholder(vd.metricLabel)) vd.metricLabel = vd.metric.slice(0, 48);
      changes.push(`metric "${vd.metric.slice(0, 30)}…" is a sentence, not a number`);
      vd.metric = undefined;
    } else {
      const ds = digitsOf(vd.metric);
      if (ds.length > 0 && !ds.some(spoken)) {
        changes.push(`metric "${vd.metric}" not spoken in beat`);
        vd.metric = undefined;
      }
    }
  }
  for (const el of vd.elements ?? []) {
    if (el.value) {
      const ds = digitsOf(el.value);
      if (ds.length > 0 && !ds.some(spoken)) {
        changes.push(`value "${el.value}" not spoken in beat`);
        el.value = '';
      }
    }
  }
  if (vd.bars) {
    const before = vd.bars.length;
    vd.bars = vd.bars.filter((b) => {
      const ds = digitsOf(`${b.label} ${b.value}`);
      return ds.length === 0 || ds.some(spoken);
    });
    if (vd.bars.length !== before) {
      changes.push(`${before - vd.bars.length} fabricated bar(s) dropped`);
    }
  }
  return changes;
};

/**
 * A data visual is only meaningful with CONCRETE payload: a real metric, two
 * labeled elements/bars/nodes, a quote, or code. Placeholder labels and
 * single empty elements don't count — they render as dead boxes.
 */
export const hasConcretePayload = (s: Scene): boolean => {
  const vd = s.visualData ?? {};
  if (vd.metric && !isPlaceholder(vd.metric) && vd.metric.trim().length <= 20) return true;
  if (vd.quote && vd.quote.trim().length > 0) return true;
  if (vd.codeSnippet && vd.codeSnippet.trim().length > 0) return true;
  const elements = vd.elements ?? [];
  if (
    elements.length >= 2 &&
    elements.every((e) => e.label && e.label.trim().length > 0 && !isPlaceholder(e.label)) &&
    elements.some((e) => (e.value && e.value.trim().length > 0) || (e.detail && e.detail.trim().length > 0))
  ) {
    return true;
  }
  const bars = vd.bars ?? [];
  if (bars.length >= 2 && bars.every((b) => b.label && b.label.trim().length > 0 && !isPlaceholder(b.label))) {
    return true;
  }
  const nodes = vd.nodes ?? [];
  if (nodes.length >= 2 && nodes.every((n) => n.label && n.label.trim().length > 0 && !isPlaceholder(n.label))) {
    return true;
  }
  return false;
};

/**
 * Remove label words from a detail/sub line ("When you make" /
 * "When you make a request" → "a request"). Returns '' when nothing
 * distinct remains — the renderer hides empty lines.
 */
const dedupDetail = (label: string | undefined, text: string | undefined): string => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean || !label) return clean.slice(0, 60);
  const labelSet = new Set(
    label
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  if (labelSet.size === 0) return clean.slice(0, 60);
  const rest = clean
    .split(/\s+/)
    .filter((w) => !labelSet.has(w.toLowerCase().replace(/[^\w]/g, '')))
    .join(' ')
    .trim();
  // A lone article/preposition ("a") is noise, not information.
  if (rest.split(/\s+/).filter((w) => w.length > 1).length === 0) return '';
  return rest.slice(0, 60);
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'nor', 'for', 'so', 'yet', 'of', 'to', 'in', 'on',
  'is', 'are', 'was', 'were', 'it', 'its', "it's", 'this', 'that', 'these', 'those',
  'their', 'them', 'they', "they're", 'with', 'without', 'from', 'as', 'at', 'by',
  'be', 'been', 'so', 'such', 'no', 'not', 'just', 'even', 'when', 'whenever',
  'you', 'your', 'yours', 'we', 'our', 'how', 'what', 'why', 'about', 'into',
  'over', 'under', 'there', "there's", 'here', "don't", 'does', "doesn't", 'than',
]);

const keywordsOf = (phrase: string, max = 4): string => {
  const words = phrase
    .replace(/[^\w\s%'-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
  return words.slice(0, max).join(' ');
};

const capitalize = (s: string): string => (s.length ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Backstop payload synthesis: build concrete visualData from the beat's OWN
 * words so a data visual always says something true to the voice. Numbers
 * ("nine hours", "90%") become metrics/bars; clauses become elements/nodes.
 * Mutates draft.visualData in place. Returns true when the draft is now
 * concrete.
 */
const synthesizePayloadFromBeat = (draft: Scene, beat: string, headline: string): boolean => {
  const vd = (draft.visualData ??= {});
  const clean = beat.replace(/\s+/g, ' ').trim();
  if (!clean) return false;

  // 1. Numbers with units → metric ("up to nine hours" won't match \d, so
  //    also accept word-numbers for the common cases).
  if (!vd.metric || isPlaceholder(vd.metric)) {
    const digitMatch = clean.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?|%|percent|million|billion|thousand|x\b|times|steps?|days?|weeks?|months?|years?|old)\b/i);
    const wordNumMatch = clean.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|fifty|hundred)\s+(hours?|minutes?|seconds?|days?|weeks?|months?|years?|times|percent)\b/i);
    const m = digitMatch ?? wordNumMatch;
    if (m) {
      vd.metric = `${m[1]} ${m[2]}`.slice(0, 20);
      vd.metricLabel = capitalize(keywordsOf(clean.replace(m[0], ' '), 4) || headline).slice(0, 48) || headline;
    }
  }

  // 2. Clauses → elements (label = keywords, detail = the clause MINUS the
  // label words — never "When you make / When you make a request" doubles).
  const stripWords = (text: string): string[] =>
    text
      .replace(/[^\w\s%'-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
  const elements = vd.elements ?? [];
  if (elements.length < 2) {
    const clauses = clean
      .split(/[,;.!?—–:]+/)
      .map((c) => c.trim())
      .filter((c) => c.split(/\s+/).length >= 2);
    for (const clause of clauses) {
      if ((vd.elements ?? []).length >= 3) break;
      const label = capitalize(keywordsOf(clause, 3));
      if (!label || isPlaceholder(label)) continue;
      if ((vd.elements ?? []).some((e) => e.label?.toLowerCase() === label.toLowerCase())) continue;
      const labelSet = new Set(label.toLowerCase().split(/\s+/));
      const rest = stripWords(clause).filter((w) => !labelSet.has(w.toLowerCase()));
      const numInClause = clause.match(/(\d+(?:\.\d+)?)\s*(hours?|%|percent|x\b|times|steps?|days?|years?|old)?\b/i);
      (vd.elements ??= []).push({
        label: label.slice(0, 30),
        value: (numInClause ? numInClause[0] : '').slice(0, 20),
        detail: rest.join(' ').slice(0, 60),
      });
    }
  }

  // 3. Percent numbers → bars for comparison visuals.
  if ((!vd.bars || vd.bars.length < 2) && !vd.metric) {
    const percents = [...clean.matchAll(/(\d+(?:\.\d+)?)\s*(%|percent)/gi)].slice(0, 3);
    if (percents.length >= 1) {
      vd.bars = percents.map((p, i) => ({
        label: capitalize(keywordsOf(clean.slice(0, clean.indexOf(p[0])), 3) || `Factor ${i + 1}`).slice(0, 30),
        value: Math.max(0, Math.min(100, Number(p[1]))),
        highlight: i === 0,
      }));
    }
  }

  // 4. Clauses → nodes when neither elements nor bars materialized.
  if ((!vd.elements || vd.elements.length < 2) && (!vd.nodes || vd.nodes.length < 2)) {
    const clauses = clean
      .split(/[,;.!?—–:]+/)
      .map((c) => c.trim())
      .filter((c) => c.split(/\s+/).length >= 3)
      .slice(0, 3);
    if (clauses.length >= 2) {
      vd.nodes = clauses.map((c) => ({
        label: capitalize(keywordsOf(c, 3) || 'Point').slice(0, 30),
        sub: c.slice(0, 40),
      }));
    }
  }

  return hasConcretePayload({ ...draft, visualData: vd });
};

export const reviewPlan = (
  script: string,
  drafts: Scene[],
  opts: { theme: ReelTheme; palette: string[] },
): ReviewResult => {
  const warnings: string[] = [];
  let repaired = false;
  const mark = (w: string): void => {
    warnings.push(w);
    repaired = true;
  };

  const narration = normalizeScriptText(script);
  if (!narration) {
    return { scenes: [], narration: '', warnings: ['Empty script — nothing to review.'], repaired: true };
  }

  // 1. Beat hygiene: drop empties, merge flashes, split overlong beats.
  let beats = mergeFlashBeats(
    drafts.map((d) => normalizeScriptText(d.narrationBeat || d.body || '')).filter(Boolean),
  );
  if (beats.length === 0) {
    // Total fallback: the script itself becomes one beat per ~10 words.
    const words = narration.split(' ').filter(Boolean);
    beats = [];
    for (let i = 0; i < words.length; i += 10) beats.push(words.slice(i, i + 10).join(' '));
    mark('All beats were empty — rebuilt beats directly from the script.');
  }

  // Split beats too long for one shot (> MAX_BEAT_WORDS).
  const split: string[] = [];
  for (const b of beats) {
    const words = b.split(' ').filter(Boolean);
    if (words.length <= MAX_BEAT_WORDS) {
      split.push(b);
    } else {
      for (let i = 0; i < words.length; i += MAX_BEAT_WORDS) {
        split.push(words.slice(i, i + MAX_BEAT_WORDS).join(' '));
      }
      mark(`Split a ${words.length}-word beat too long for one shot.`);
    }
  }
  beats = mergeFlashBeats(split);

  // 2. Scene count must match beat count — expand or collapse drafts.
  const scenes: Scene[] = [];
  const palette = opts.palette.length ? opts.palette : THEME_PALETTES[opts.theme];
  const rotation = THEME_ROTATION[opts.theme] ?? THEME_ROTATION.education;
  const usedCount = new Map<Visual, number>();

  for (let i = 0; i < beats.length; i += 1) {
    const draft: Scene =
      drafts[Math.min(i, drafts.length - 1)] ?? {
        kicker: `Beat ${i + 1}`,
        headline: 'Key idea',
        body: beats[i],
        visual: 'kinetic_typography',
        accent: palette[(i + 1) % palette.length],
        durationWeight: 1,
      };

    // 3. Visual diversity: never repeat the previous visual; cap reuse at 40%.
    let visual: Visual = ALL_VISUALS.includes(draft.visual) ? draft.visual : rotation[i % rotation.length];
    if (i > 0 && visual === scenes[i - 1].visual) {
      const alt = rotation.find((v) => v !== visual && (usedCount.get(v) ?? 0) < Math.ceil(beats.length * 0.4));
      visual = alt ?? TYPOGRAPHY_SAFE[i % TYPOGRAPHY_SAFE.length];
      mark(`Scene ${i + 1} repeated "${scenes[i - 1].visual}" — rotated to "${visual}".`);
    }
    const maxReuse = Math.max(2, Math.ceil(beats.length * 0.4));
    if ((usedCount.get(visual) ?? 0) >= maxReuse) {
      const alt = rotation.find((v) => (usedCount.get(v) ?? 0) < maxReuse && (i === 0 || v !== scenes[i - 1].visual));
      if (alt) {
        mark(`Scene ${i + 1} overused "${visual}" — rotated to "${alt}".`);
        visual = alt;
      }
    }
    usedCount.set(visual, (usedCount.get(visual) ?? 0) + 1);

    const beatText = beats[i];

    // Dedup pass: element details and node subs must ADD words, never echo
    // the label ("Request / Consumes token" stays; "X / ...X..." is trimmed).
    for (const el of draft.visualData?.elements ?? []) {
      if (el.detail) el.detail = dedupDetail(el.label, el.detail);
    }
    for (const node of draft.visualData?.nodes ?? []) {
      if (node.sub) node.sub = dedupDetail(node.label, node.sub);
    }

    // Metric scrub: a placeholder metric ("Key stat") poisons even an
    // otherwise fine payload — the big cell would still read as filler.
    // Rebuild it from beat numbers, or drop it so the headline carries the cell.
    if (draft.visualData?.metric && isPlaceholder(draft.visualData.metric)) {
      const before = draft.visualData.metric;
      draft.visualData.metric = undefined;
      synthesizePayloadFromBeat(draft, beatText, draft.headline || '');
      if (draft.visualData.metric && !isPlaceholder(draft.visualData.metric)) {
        mark(`Scene ${i + 1} metric "${before}" was filler — replaced with "${draft.visualData.metric}".`);
      } else {
        draft.visualData.metric = undefined;
        mark(`Scene ${i + 1} metric "${before}" was filler with no number in the beat — headline carries the cell.`);
      }
    }

    // Number grounding FIRST: digits on screen must be spoken in the beat.
    // Fabricated analytics ("83%" with no 83 in the voice) are dropped here.
    for (const change of groundNumbersToBeat(draft, beatText)) {
      mark(`Scene ${i + 1}: ${change}.`);
    }

    // Concrete-payload gate: data visuals with placeholder/empty payload
    // render as dead boxes. First try synthesizing real content from the
    // beat's own words; demote to kinetic type only if that fails too.
    if (DATA_HEAVY.includes(visual) && !hasConcretePayload(draft)) {
      if (synthesizePayloadFromBeat(draft, beatText, draft.headline || '')) {
        mark(`Scene ${i + 1} data visual "${visual}" had filler copy — rebuilt payload from the voiceover.`);
      } else {
        const fallback = TYPOGRAPHY_SAFE[i % TYPOGRAPHY_SAFE.length];
        mark(`Scene ${i + 1} used data visual "${visual}" with no usable data — demoted to "${fallback}".`);
        visual = fallback;
      }
    }

    // Comparison needs ≥2 grounded bars — a head-to-head with invented
    // numbers is worse than none. Split-screen compares without percents.
    if (visual === 'comparison_matrix' && (draft.visualData?.bars ?? []).length < 2) {
      const els = draft.visualData?.elements ?? [];
      if (els.length >= 2) {
        visual = 'split_screen';
        mark(`Scene ${i + 1} comparison had no grounded numbers — honest side-by-side instead.`);
      } else {
        visual = TYPOGRAPHY_SAFE[i % TYPOGRAPHY_SAFE.length];
        mark(`Scene ${i + 1} comparison had no grounded numbers — demoted to "${visual}".`);
      }
    }

    // Container semantics (bucket/fill/empty/full/drain): a filling ring
    // reads as the concept itself — but only with a real number to fill to.
    if (
      (visual === 'bento_grid' || visual === 'stat_spotlight') &&
      /\b(bucket|fill|empty|full|drain|pour|tank|capacity|quota)\b/i.test(beatText) &&
      draft.visualData?.metric &&
      /\d/.test(draft.visualData.metric)
    ) {
      visual = 'radial_gauge';
      mark(`Scene ${i + 1} is a fill/empty beat with a real number — ring gauge instead of boxes.`);
    }

    // Relevance: a code terminal only belongs on genuinely technical beats.
    if (visual === 'terminal_stream' && opts.theme !== 'tech' && !draft.visualData?.codeSnippet) {
      visual = TYPOGRAPHY_SAFE[i % TYPOGRAPHY_SAFE.length];
      mark(`Scene ${i + 1} put a code terminal on a non-technical beat — demoted to "${visual}".`);
    }

    // Relevance: personal/anecdotal beats render as type/dialogue, never charts.
    if (DATA_HEAVY.includes(visual) && ANECDOTE_RE.test(beatText)) {
      const fallback =
        opts.theme === 'comedy'
          ? 'dialogue_cards'
          : (['kinetic_typography', 'quote_card'] as Visual[])[i % 2];
      mark(`Scene ${i + 1} is a personal beat ("${beatText.slice(0, 40)}…") — chart "${visual}" demoted to "${fallback}".`);
      visual = fallback;
    }

    // 4. Text safety: headlines must fit the HUD (≤8 words), bodies ≤28 words,
    // and the headline must not parrot the spoken beat (the "double text" bug).
    const beat = beats[i];
    let headline = String(draft.headline || '').replace(/\s+/g, ' ').trim() || 'Key idea';
    headline = clampWords(headline, 8);
    if (normalizeScriptText(headline).toLowerCase() === beat.toLowerCase()) {
      // Derive a short label from the beat's most distinctive words instead.
      const stop = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'is', 'are', 'it', 'this', 'that']);
      const keywords = beat
        .replace(/[^\w\s]/g, '')
        .split(' ')
        .filter((w) => w.length > 4 && !stop.has(w.toLowerCase()))
        .slice(0, 3);
      headline = keywords.length ? keywords.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : `Point ${i + 1}`;
      mark(`Scene ${i + 1} headline parroted the voiceover — rewrote to "${headline}".`);
    }
    let body = String(draft.body || beat).replace(/\s+/g, ' ').trim();
    body = clampWords(body, 28);

    const accent = isHex(draft.accent) ? String(draft.accent) : palette[(i + 1) % palette.length];
    if (!isHex(draft.accent)) mark(`Scene ${i + 1} had an invalid accent — reset to palette.`);

    scenes.push({
      kicker: String(draft.kicker || `Beat ${i + 1}`).replace(/\s+/g, ' ').trim().slice(0, 28) || `Beat ${i + 1}`,
      headline: headline.slice(0, 64),
      body: body.slice(0, 180),
      narrationBeat: beat,
      visual,
      accent,
      durationWeight: 1, // voice-driven timing; LLM nudges are discarded (see timeline.ts)
      transition: draft.transition,
      visualData: draft.visualData,
      imageUrl: draft.imageUrl,
    });
  }

  // 5. Final AV-sync assertion: join(beats) must equal narration exactly.
  const joined = normalizeScriptText(scenes.map((s) => s.narrationBeat || '').join(' '));
  if (joined !== narration) {
    // This should be unreachable when the caller uses alignBeatsToScript —
    // if it fires, fail loudly in logs rather than shipping a desynced reel.
    warnings.push(
      `AV-SYNC FAULT: joined beats differ from narration (${joined.split(' ').length} vs ${narration.split(' ').length} words).`,
    );
    repaired = true;
  }

  return { scenes, narration, warnings, repaired };
};

/**
 * Timed review: beats come from the REAL voice transcript (start/end/words
 * measured, not guessed), so they are NEVER re-cut here — every beat keeps
 * its exact spoken words and timestamps. The LLM drafts only supply the
 * visuals/copy per beat and go through the same diversity, relevance, and
 * text-safety checks as reviewPlan.
 */
export const reviewTimedPlan = (
  beats: TimedBeat[],
  drafts: Scene[],
  opts: { theme: ReelTheme; palette: string[] },
): ReviewResult => {
  if (beats.length === 0) {
    return { scenes: [], narration: '', warnings: ['Empty transcript — nothing to review.'], repaired: true };
  }
  const palette = opts.palette.length ? opts.palette : THEME_PALETTES[opts.theme];
  const safeDrafts: Scene[] = drafts.length
    ? drafts
    : beats.map(
        (b, i): Scene => ({
          kicker: `Beat ${i + 1}`,
          headline: 'Key idea',
          body: b.text,
          narrationBeat: b.text,
          visual: 'kinetic_typography',
          accent: palette[(i + 1) % palette.length],
          durationWeight: 1,
        }),
      );

  // Beats are 3–16 words by construction (see groupWordsIntoBeats), so
  // reviewPlan's split/merge hygiene is a no-op and the scene count is
  // preserved 1:1 — each reviewed scene maps back onto its timed beat.
  const pseudoScript = beats.map((b) => b.text).join(' ');
  const pseudoDrafts = beats.map((b, i) => ({
    ...safeDrafts[i % safeDrafts.length],
    narrationBeat: b.text,
  }));
  const result = reviewPlan(pseudoScript, pseudoDrafts, opts);
  if (result.scenes.length !== beats.length) {
    // Defensive: should be unreachable; keep audio truth over visuals.
    console.warn(
      `[review] timed beat/scene count mismatch (${beats.length} beats vs ${result.scenes.length} scenes) — re-aligning to beats.`,
    );
  }

  const scenes = beats.map((b, i) => {
    const reviewed: Scene =
      result.scenes[Math.min(i, result.scenes.length - 1)] ?? pseudoDrafts[i % pseudoDrafts.length];
    const tokens = b.text.split(/\s+/).filter(Boolean);
    const timings =
      b.words.length === tokens.length
        ? b.words.map((w) => Math.max(0, Number((w.start - b.start).toFixed(3)) || 0))
        : undefined;
    return {
      ...reviewed,
      narrationBeat: b.text,
      start: b.start,
      end: b.end,
      wordTimings: timings,
      durationWeight: 1,
    };
  });

  return { ...result, scenes, narration: normalizeScriptText(pseudoScript) };
};
