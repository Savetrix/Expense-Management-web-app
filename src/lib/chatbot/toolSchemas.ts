// OpenAI function-calling schemas for the tools in ./tools.ts. Kept as a
// separate file from the implementations so the "what can the model ask
// for" contract is easy to read/audit on its own — mirrors how
// mcp/mcp-server/src/tools/schemas.ts is split from src/tools/index.ts in
// the sibling project.
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";

export const chatToolSchemas: ChatCompletionFunctionTool[] = [
  {
    type: "function",
    function: {
      name: "list_invoices",
      description:
        "List invoices for the signed-in user's currently active company, optionally filtered by status, vendor name, or date range. Use for questions like 'what invoices are pending' or 'show invoices from Acme'.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "manual", "auto", "failed", "processing"],
            description: "Filter by posted status.",
          },
          vendorName: {
            type: "string",
            description: "Case-insensitive substring match against the vendor name on each invoice.",
          },
          fromDate: { type: "string", description: "ISO date (YYYY-MM-DD). Only invoices on/after this date." },
          toDate: { type: "string", description: "ISO date (YYYY-MM-DD). Only invoices on/before this date." },
          limit: { type: "number", description: "Max invoices to return (capped at 20 regardless of this value)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_invoice_detail",
      description:
        "Get full details for one specific invoice by its id (as returned from list_invoices). Use when the user asks about one particular invoice.",
      parameters: {
        type: "object",
        properties: {
          invoiceId: { type: "string", description: "The invoice's id, from a prior tool result." },
        },
        required: ["invoiceId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "summarize_spend",
      description:
        "Compute total spend/counts grouped by vendor, month, or status, already aggregated server-side. ALWAYS use this for any question involving a sum, total, or count of invoices/spend — never add up amounts from list_invoices yourself.",
      parameters: {
        type: "object",
        properties: {
          groupBy: { type: "string", enum: ["vendor", "month", "status"] },
          fromDate: { type: "string", description: "ISO date (YYYY-MM-DD)." },
          toDate: { type: "string", description: "ISO date (YYYY-MM-DD)." },
        },
        required: ["groupBy"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_vendors",
      description: "List vendors for the active company, including their default GL account/tax code.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive"], description: "Defaults to active." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_gl_accounts",
      description: "List the GL (general ledger) accounts configured for the active company.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tax_codes",
      description: "List the tax codes configured for the active company.",
      parameters: { type: "object", properties: {} },
    },
  },
  // ── Write: Invoice ─────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "update_invoice",
      description:
        "Patch extracted fields on a single invoice (vendor, amount, GL account, tax code, dates, description, line items). " +
        "Does NOT post to the accounting software — use post_invoice_to_qb for that. Pass only the fields you want to change. " +
        "invoiceId comes from list_invoices or get_invoice_detail.",
      parameters: {
        type: "object",
        properties: {
          invoiceId: { type: "string", description: "The invoice's id, from a prior tool result." },
          extractedData: {
            type: "object",
            description: "Fields to update. Only include the fields you want to change.",
            properties: {
              vendorName: { type: "string" },
              currency: { type: "string" },
              invoiceNumber: { type: "string" },
              invoiceDate: { type: ["string", "null"] },
              dueDate: { type: ["string", "null"] },
              amountBeforeTax: { type: "number" },
              taxAmount: { type: "number" },
              totalAmount: { type: "number" },
              glAccountId: { type: ["string", "null"] },
              taxCodeId: { type: ["string", "null"] },
              description: { type: ["string", "null"] },
              vendorAddress: { type: ["string", "null"] },
              lineItems: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    description: { type: "string" },
                    quantity: { type: "number" },
                    unitPrice: { type: "number" },
                    amount: { type: "number" },
                    glAccountId: { type: "string" },
                  },
                },
              },
            },
          },
        },
        required: ["invoiceId", "extractedData"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "post_invoice_to_qb",
      description:
        "Post an approved invoice to the connected accounting software (QuickBooks or Xero; sets postedStatus to 'manual'). " +
        "Before calling this, the model MUST describe exactly what it will do and wait for the user to confirm. " +
        "The confirm field MUST be set to true only after the user explicitly agrees — otherwise the tool returns a confirmation-required message. " +
        "invoiceId comes from list_invoices; vendorId comes from list_vendors.",
      parameters: {
        type: "object",
        properties: {
          invoiceId: { type: "string" },
          vendorId: { type: "string" },
          extractedData: {
            type: "object",
            properties: {
              vendorName: { type: "string" },
              currency: { type: "string" },
              invoiceNumber: { type: "string" },
              invoiceDate: { type: ["string", "null"] },
              dueDate: { type: ["string", "null"] },
              amountBeforeTax: { type: "number" },
              taxAmount: { type: "number" },
              totalAmount: { type: "number" },
              glAccountId: { type: ["string", "null"] },
              taxCodeId: { type: ["string", "null"] },
              description: { type: ["string", "null"] },
              vendorAddress: { type: ["string", "null"] },
              lineItems: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    description: { type: "string" },
                    quantity: { type: "number" },
                    unitPrice: { type: "number" },
                    amount: { type: "number" },
                    glAccountId: { type: "string" },
                  },
                },
              },
            },
          },
          confirm: { type: "boolean", description: "Must be true — this action posts to the accounting software and cannot be undone." },
        },
        required: ["invoiceId", "vendorId", "extractedData", "confirm"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_invoice",
      description:
        "Reject an invoice (sets postedStatus to 'failed') with an optional reason. " +
        "Before calling this, the model MUST describe exactly what it will do and wait for the user to confirm. " +
        "The confirm field MUST be set to true only after the user explicitly agrees.",
      parameters: {
        type: "object",
        properties: {
          invoiceId: { type: "string", description: "The invoice's id, from a prior tool result." },
          reason: { type: "string", description: "Why this invoice is being rejected (e.g. 'duplicate', 'bad scan')." },
          confirm: { type: "boolean", description: "Must be true — this action rejects an invoice and cannot be undone." },
        },
        required: ["invoiceId", "confirm"],
      },
    },
  },
  // ── Write: Vendor ──────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_vendor",
      description:
        "Create a new vendor in the connected accounting software. Requires display name, currency, AND a default GL account — " +
        "the app's own 'add vendor' form enforces the same rule. " +
        "Call list_gl_accounts first and ask the user which account to use if they didn't already say. " +
        "Tax code, email, phone, and address are optional.",
      parameters: {
        type: "object",
        properties: {
          displayName: { type: "string" },
          currency: { type: "string", description: "Currency code, e.g. 'USD'." },
          glAccountId: { type: "string", description: "Required default GL account id, from list_gl_accounts." },
          email: { type: "string" },
          phone: { type: "string" },
          address: { type: "string" },
          taxCodeId: { type: "string", description: "Optional default tax code id, from list_tax_codes." },
        },
        required: ["displayName", "currency", "glAccountId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_vendor",
      description:
        "Update an existing vendor's email, phone, address, currency, default GL account, or default tax code. " +
        "Pass only the fields you want to change. vendorId comes from list_vendors.",
      parameters: {
        type: "object",
        properties: {
          vendorId: { type: "string" },
          displayName: { type: "string" },
          currency: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          address: { type: "string" },
          glAccountId: { type: "string" },
          taxCodeId: { type: "string" },
        },
        required: ["vendorId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deactivate_vendor",
      description:
        "Deactivate (soft-delete) a vendor so it no longer appears in active lists. " +
        "Before calling this, the model MUST describe exactly what it will do and wait for the user to confirm. " +
        "The confirm field MUST be set to true only after the user explicitly agrees.",
      parameters: {
        type: "object",
        properties: {
          vendorId: { type: "string", description: "The vendor's id, from a prior tool result." },
          confirm: { type: "boolean", description: "Must be true — this action deactivates a vendor." },
        },
        required: ["vendorId", "confirm"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reactivate_vendor",
      description:
        "Bring a previously deactivated vendor back as active. vendorId comes from list_vendors with status='inactive'.",
      parameters: {
        type: "object",
        properties: {
          vendorId: { type: "string", description: "The vendor's id, from a prior tool result." },
        },
        required: ["vendorId"],
      },
    },
  },
  // ── Write: GL Account ──────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_gl_account",
      description:
        "Create a new GL (general ledger) account in the connected accounting software — e.g. a new expense category. " +
        "Pass the account name and account type, and: for QuickBooks optionally an account sub-type; " +
        "for Xero a unique account code (Xero requires one).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The account name, e.g. 'Office Supplies'." },
          accountType: {
            type: "string",
            description: "Account type in the connected software's own terms — QuickBooks e.g. 'Expense', 'Cost of Goods Sold'; Xero e.g. 'EXPENSE', 'OVERHEADS', 'DIRECTCOSTS'.",
          },
          accountSubType: { type: "string", description: "Optional QuickBooks account sub-type, e.g. 'Supplies'. Ignored by Xero." },
          code: { type: "string", description: "Account code, e.g. '429'. Required for Xero, ignored by QuickBooks." },
        },
        required: ["name", "accountType"],
      },
    },
  },
  // ── Write: Sync ────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "sync_accounts",
      description:
        "Pull the latest GL accounts from the connected accounting software into the app. Use when the user wants to refresh their account list after adding one there directly.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "sync_tax_codes",
      description:
        "Pull the latest tax codes from the connected accounting software into the app. Use when the user wants to refresh their tax code list after adding one there directly.",
      parameters: { type: "object", properties: {} },
    },
  },
];
