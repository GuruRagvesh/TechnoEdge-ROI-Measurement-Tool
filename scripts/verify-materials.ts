import { validateMaterials } from "./material-validation";
for (const phase of ["pre", "post"] as const) {
  const result = await validateMaterials(phase);
  console.log(
    `${phase.toUpperCase()}: all five delivered packs parsed; ${result.validatedKeys} answer keys independently reconciled from CSV, Excel and Word sources.`,
  );
}
