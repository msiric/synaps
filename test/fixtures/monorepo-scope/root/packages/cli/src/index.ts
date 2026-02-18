import { Command } from "commander";

const program = new Command();

program
  .name("my-cli")
  .description("A CLI tool")
  .version("2.0.0");

program.command("run")
  .description("Run the tool")
  .action(() => {
    console.log("Running...");
  });

export { program };
