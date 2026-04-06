#!/usr/bin/env node

import { Command } from "commander";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { projectsCommand } from "./commands/projects.js";
import { statusCommand } from "./commands/status.js";
import { launchCommand } from "./commands/launch.js";
import { shutdownCommand } from "./commands/shutdown.js";
import { feedbackCommand } from "./commands/feedback.js";
import { reactorCommand } from "./commands/reactor.js";
import { standupCommand } from "./commands/standup.js";

const program = new Command();

program
  .name("cockpit")
  .description("Multi-project agent orchestration for Claude Code")
  .version("0.1.0");

program.addCommand(doctorCommand);
program.addCommand(initCommand);
program.addCommand(projectsCommand);
program.addCommand(statusCommand);
program.addCommand(launchCommand);
program.addCommand(shutdownCommand);
program.addCommand(feedbackCommand);
program.addCommand(reactorCommand);
program.addCommand(standupCommand);

program.parse();
