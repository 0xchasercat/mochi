#!/usr/bin/env bun
import { main } from "./index";

const code = await main(Bun.argv.slice(2));
process.exit(code);
