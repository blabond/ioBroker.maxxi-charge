import { fileURLToPath } from "node:url";
import iobrokerTesting from "@iobroker/testing";

const { tests } = iobrokerTesting;

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(fileURLToPath(new URL("..", import.meta.url)));
