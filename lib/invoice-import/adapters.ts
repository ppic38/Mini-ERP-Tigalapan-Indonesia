// Registri adapter invoice per supplier. Tiap supplier material punya template invoice sendiri,
// jadi parser dibuat per-supplier (adapter) -- menambah supplier baru = menambah 1 adapter di sini
// tanpa menyentuh yang sudah ada. Supplier tanpa adapter tetap memakai input manual.

import { parseKnittoInvoice, validateInvoice } from "./parser-knitto";
import { FABRIKU_FILENAME_RULE, parseFabrikuInvoice, validateFabrikuInvoice } from "./parser-fabriku";
import type { InvoiceAdapter } from "./types";

const KNITTO: InvoiceAdapter = {
  id: "knitto",
  label: "KNITTO",
  matchesSupplier: (name) => /KNITTO/i.test(name),
  parse: parseKnittoInvoice,
  validate: validateInvoice,
  // No Penjualan KNITTO = 2 huruf + angka (mis. OH131026179).
  fileNameRule: { noPattern: /^[A-Z]{2}\d{6,}$/, example: "OH131026179.5393.pdf" },
};

const FABRIKU: InvoiceAdapter = {
  id: "fabriku",
  label: "FABRIKU",
  matchesSupplier: (name) => /FABRIKU/i.test(name),
  parse: parseFabrikuInvoice,
  validate: validateFabrikuInvoice,
  fileNameRule: FABRIKU_FILENAME_RULE,
};

export const INVOICE_ADAPTERS: InvoiceAdapter[] = [KNITTO, FABRIKU];

export function adapterForSupplier(supplierName: string | null | undefined): InvoiceAdapter | null {
  if (!supplierName) return null;
  return INVOICE_ADAPTERS.find((a) => a.matchesSupplier(supplierName)) ?? null;
}
