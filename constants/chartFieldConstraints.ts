import { ChartType } from '../types';
import { ColumnValueType } from '../utils/columnProfiles';

export type ChartFieldKey =
  | 'dimension'
  | 'stackBy'
  | 'measureCol'
  | 'xMeasureCol'
  | 'yMeasureCol'
  | 'xDimension'
  | 'yDimension'
  | 'sizeDimension'
  | 'colorBy';

export interface FieldConstraint {
  key: ChartFieldKey;
  label: string;
  helper?: string;
  required: boolean;
  allowedTypes: ColumnValueType[];
}

const textOnly = ['text'] as ColumnValueType[];
const numericOnly = ['number'] as ColumnValueType[];
const textOrDate = ['text', 'date'] as ColumnValueType[];
const numericOrDate = ['number', 'date'] as ColumnValueType[];

const baseDimension = (label = 'Dimension'): FieldConstraint => ({
  key: 'dimension',
  label,
  required: true,
  allowedTypes: textOrDate,
  helper: 'Pick the category axis (text or date columns work best)'
});

const measureConstraint: FieldConstraint = {
  key: 'measureCol',
  label: 'Value Column',
  required: false,
  allowedTypes: numericOnly,
  helper: 'Required only when using Sum or Average'
};

const scatterMeasureX: FieldConstraint = {
  key: 'xMeasureCol',
  label: 'X Value Column',
  required: false,
  allowedTypes: numericOnly,
  helper: 'Required only when using Sum or Average'
};

const scatterMeasureY: FieldConstraint = {
  key: 'yMeasureCol',
  label: 'Y Value Column',
  required: false,
  allowedTypes: numericOnly,
  helper: 'Required only when using Sum or Average'
};

const stackConstraint: FieldConstraint = {
  key: 'stackBy',
  label: 'Stack By',
  required: true,
  allowedTypes: textOnly,
  helper: 'Break each column/bar into parts using this category'
};

const seriesByConstraint: FieldConstraint = {
  key: 'stackBy',
  label: 'Series By',
  required: true,
  allowedTypes: textOnly,
  helper: 'Group lines by this category'
};

const scatterX: FieldConstraint = {
  key: 'xDimension',
  label: 'X-Axis',
  required: true,
  allowedTypes: numericOrDate,
  helper: 'Must be numeric or date values'
};

const scatterY: FieldConstraint = {
  key: 'yDimension',
  label: 'Y-Axis',
  required: true,
  allowedTypes: numericOnly,
  helper: 'Numeric data only'
};

const bubbleSize: FieldConstraint = {
  key: 'sizeDimension',
  label: 'Bubble Size',
  required: true,
  allowedTypes: numericOnly,
  helper: 'Numeric column that controls bubble radius'
};

const colorByConstraint: FieldConstraint = {
  key: 'colorBy',
  label: 'Color By',
  required: false,
  allowedTypes: textOnly,
  helper: 'Optional dimension to color-code each point'
};

const pieDimension = (): FieldConstraint => ({
  ...baseDimension('Category'),
  helper: 'Text categories only – used to slice the pie/donut'
});

const constraintsMap: Partial<Record<ChartType, FieldConstraint[]>> = {
  column: [baseDimension()],
  'stacked-column': [baseDimension(), stackConstraint],
  '100-stacked-column': [baseDimension(), stackConstraint],
  'compare-column': [baseDimension('Category'), seriesByConstraint],
  bar: [baseDimension()],
  'compare-bar': [baseDimension('Category'), seriesByConstraint],
  'stacked-bar': [baseDimension(), stackConstraint],
  '100-stacked-bar': [baseDimension(), stackConstraint],
  line: [baseDimension()],
  'smooth-line': [baseDimension()],
  'multi-line': [baseDimension('Date'), seriesByConstraint],
  area: [baseDimension()],
  'stacked-area': [baseDimension(), stackConstraint],
  '100-stacked-area': [baseDimension(), stackConstraint],
  pie: [pieDimension()],
  donut: [pieDimension()],
  scatter: [baseDimension('Group By'), scatterMeasureX, scatterMeasureY],
  bubble: [baseDimension('Group By'), scatterMeasureX, scatterMeasureY, bubbleSize],
  combo: [baseDimension()]
};

export const getFieldConstraints = (type: ChartType): FieldConstraint[] => {
  const defaults = constraintsMap[type] || [];
  // Measure requirement for most chart types except table/wordcloud
  const needsMeasure = !['table', 'wordcloud'].includes(type);
  const constraints = [...defaults];
  if (needsMeasure) {
    constraints.push(measureConstraint);
  }
  return constraints;
};
