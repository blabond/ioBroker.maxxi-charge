import { fileURLToPath } from "node:url";
import iobrokerTesting from "@iobroker/testing";

const { tests } = iobrokerTesting;

// Validate the package files
tests.packageFiles(fileURLToPath(new URL("..", import.meta.url)));
