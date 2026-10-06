// Registri adapter invoice per supplier. Tiap supplier material punya template invoice sendiri,
// jadi parser dibuat per-supplier (adapter) -- menambah supplier baru = menambah 1 adapter di sini
// tanpa menyentuh yang sudah ada. Supplier tanpa adapter tetap memakai input manual.

import { parseKnittoInvoice, validateInvoice } from "./parser-knitto";
import type { InvoiceAdapter } from "./types";

const KNITTO: InvoiceAdapter = {
  id: "knitto",
  label: "KNITTO",
  matchesSupplier: (name) => /KNITTO/i.test(name),
  parse: parseKnittoInvoice,
  validate: validateInvoice,
};

export const INVOICE_ADAPTERS: InvoiceAdapter[] = [KNITTO];

export function adapterForSupplier(supplierName: string | null | undefined): InvoiceAdapter | null {
  if (!supplierName) return null;
  return INVOICE_ADAPTERS.find((a) => a.matchesSupplier(supplierName)) ?? null;
}
