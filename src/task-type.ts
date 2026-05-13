import { TaskType } from './schema/task.js';
import { DESCRIPTION_INLINE_HINT } from './task-contract.js';

export { DESCRIPTION_INLINE_HINT } from './task-contract.js';

export type TaskTypeDefinition = {
  key: typeof TaskType[keyof typeof TaskType];
  label: string;
  meaning: string;
  descriptionRule: string;
  typicalActions: string[];
};

export const TASK_TYPE_DEFINITIONS: TaskTypeDefinition[] = [
  {
    key: TaskType.GENERAL,
    label: 'General',
    meaning: 'Generic coordination or lightweight action when no specialist type dominates.',
    descriptionRule: 'Describe one concrete current baton executable without domain-specific tooling.',
    typicalActions: [
      'triage one incoming request',
      'prepare one handoff note',
      'perform one generic follow-up check',
    ],
  },
  {
    key: TaskType.CODING,
    label: 'Coding',
    meaning: 'Implementing, modifying, debugging, or validating code and tests.',
    descriptionRule: 'State one concrete code change or one test/debug action for the current step.',
    typicalActions: [
      'implement one function or module change',
      'fix one reproducible bug',
      'run one test scope and report result',
    ],
  },
  {
    key: TaskType.RESEARCH,
    label: 'Research',
    meaning: 'Information gathering, comparison, analysis, or evidence synthesis.',
    descriptionRule: 'State one clear research question and expected evidence output for the current step.',
    typicalActions: [
      'collect references for one topic',
      'compare options under one criterion set',
      'summarize findings with traceable evidence',
    ],
  },
  {
    key: TaskType.OPS,
    label: 'Ops',
    meaning: 'Runtime environment, deployment, service operations, and incident handling.',
    descriptionRule: 'State one environment or operational action with explicit target system and verification.',
    typicalActions: [
      'restart one service safely',
      'apply one environment configuration change',
      'diagnose one runtime incident symptom',
    ],
  },
  {
    key: TaskType.DATA,
    label: 'Data',
    meaning: 'Data extraction, cleaning, transformation, calculation, and structured validation.',
    descriptionRule: 'State one concrete data operation plus expected output shape for the current step.',
    typicalActions: [
      'extract one dataset slice',
      'clean one schema segment',
      'compute one metric batch',
    ],
  },
  {
    key: TaskType.DESIGN,
    label: 'Design',
    meaning: 'UI/UX or visual/interaction design decisions and deliverables.',
    descriptionRule: 'State one design deliverable or one design-decision step with explicit scope.',
    typicalActions: [
      'draft one UI flow',
      'revise one interaction pattern',
      'prepare one visual spec update',
    ],
  },
  {
    key: TaskType.CONTENT,
    label: 'Content',
    meaning: 'Writing, editing, formatting, and publishing textual content artifacts.',
    descriptionRule: 'State one writing/editing deliverable for the current step and target format.',
    typicalActions: [
      'draft one section',
      'revise one document for clarity',
      'format one publish-ready content block',
    ],
  },
  {
    key: TaskType.ECOMMERCE,
    label: 'Ecommerce',
    meaning: 'Cross-border ecommerce operations such as listing, pricing, sourcing, and channel execution.',
    descriptionRule: 'State one concrete ecommerce operation baton with explicit product or channel constraint.',
    typicalActions: [
      'prepare one product listing draft',
      'evaluate one SKU pricing or margin action',
      'run one channel-specific operation step',
    ],
  },
];

export const TASK_TYPE_INLINE_HINT = TASK_TYPE_DEFINITIONS
  .map((def) => `${def.key}=${def.meaning}`)
  .join(' | ');

export function buildTaskTypeGuidanceBlock(): string {
  const lines: string[] = ['TaskType definitions (choose by current baton):'];
  for (const def of TASK_TYPE_DEFINITIONS) {
    lines.push(`- ${def.key}: ${def.meaning}`);
    lines.push(`  description rule: ${def.descriptionRule}`);
    lines.push(`  examples: ${def.typicalActions.join(' ; ')}`);
  }
  return lines.join('\n');
}

export function buildTaskDescriptionQualityRules(): string {
  return [
    'Description quality rules:',
    '- description means current baton only, not final goal.',
    `- ${DESCRIPTION_INLINE_HINT}`,
    '- avoid multi-step connectors such as "then / next / finally".',
    '- avoid acceptance/closure language such as "task complete / acceptance / close".',
    '- include explicit target and constraint when needed.',
  ].join('\n');
}
