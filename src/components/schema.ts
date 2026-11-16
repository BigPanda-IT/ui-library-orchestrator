import { z } from "zod";

const text = z.string().min(1);
const jsonValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const propMetadataSchema = z.object({
  name: text,
  type: text,
  required: z.boolean(),
  allowedValues: z.array(jsonValue).optional(),
  defaultValue: jsonValue.optional(),
  description: z.string().optional(),
  deprecated: z.union([z.string(), z.boolean()]).optional(),
  declaredIn: text.optional(),
}).strict();

export const curatedExampleSchema = z.object({
  title: text,
  description: z.string().optional(),
  code: text,
}).strict();

// Общий контракт генератора индекса и его читателей.
export const componentMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  id: text,
  kind: z.literal("component"),
  name: text,
  package: z.object({ name: text, version: text }).strict(),
  description: z.string().optional(),
  import: z.object({ style: z.literal("named"), name: text, from: text }).strict(),
  compactSignature: text,
  propsType: text,
  props: z.array(propMetadataSchema),
  usage: z.object({
    whenToUse: z.array(text),
    whenNotToUse: z.array(text),
    constraints: z.array(text),
  }).strict(),
  examples: z.array(curatedExampleSchema),
  keywords: z.array(text),
  source: z.object({
    exportEntry: text,
    implementation: text,
    propDeclarations: z.array(text),
    curatedDocs: text,
  }).strict(),
}).strict();

export type PropMetadata = z.infer<typeof propMetadataSchema>;
export type CuratedExample = z.infer<typeof curatedExampleSchema>;
export type ComponentMetadata = z.infer<typeof componentMetadataSchema>;
