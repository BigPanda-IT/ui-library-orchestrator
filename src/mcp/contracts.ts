import { z } from "zod";
import { componentMetadataSchema } from "../components/schema";

// Сервер публикует эти схемы, клиент проверяет ими полученные данные.
export const searchResultSchema = z.object({
  query: z.string(),
  total: z.number().int().nonnegative(),
  components: z.array(componentMetadataSchema.pick({
    id: true, name: true, description: true, package: true, source: true,
  })),
});

export const docsResultSchema = z.object({
  found: z.boolean(),
  name: z.string(),
  component: componentMetadataSchema.nullable(),
  message: z.string(),
  checks: z.object({ props: z.literal("not_run"), typescript: z.literal("not_run") }),
});
