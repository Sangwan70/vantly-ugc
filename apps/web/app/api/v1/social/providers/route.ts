// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
import { proxy } from '../_proxy';
export async function GET() { return proxy('GET', '/v1/social/providers'); }
