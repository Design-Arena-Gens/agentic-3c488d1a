import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveBaseUrl } from "@/lib/pi42";

const requestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  path: z.string().startsWith("/"),
  target: z.enum(["public", "private"]).default("public"),
  query: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .default({}),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .default({}),
  body: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
});

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = requestSchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { method, path, target, query, headers, body } = parsed.data;
    const baseUrl = resolveBaseUrl(target);
    const url = new URL(path, baseUrl);

    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });

    const forwardHeaders = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
    });

    Object.entries(headers ?? {}).forEach(([key, value]) => {
      if (!value) return;
      forwardHeaders.set(key, value);
    });

    const forwardInit: RequestInit = {
      method,
      headers: forwardHeaders,
      cache: "no-store",
    };

    if (body !== undefined) {
      forwardInit.body =
        typeof body === "string" ? body : JSON.stringify(body, null, 0);
    }

    const response = await fetch(url, forwardInit);
    const text = await response.text();
    let data: unknown;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    return NextResponse.json(
      {
        status: response.status,
        statusText: response.statusText,
        data,
      },
      { status: response.status },
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
