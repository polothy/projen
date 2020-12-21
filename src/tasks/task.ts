import { TaskSpec, TaskStep, TaskStepOptions } from './model';
import { Tasks } from './tasks';

export interface TaskCommonOptions {
  /**
   * The docker image to use when running this task
   * @default - TBD
   */
  readonly image?: string;

  /**
   * The description of this build command.
   * @default - the task name
   */
  readonly description?: string;

  /**
   * Category for start menu.
   *
   * @default TaskCategory.MISC
   */
  readonly category?: TaskCategory;

  /**
   * Defines environment variables for the execution of this task.
   * Values in this map will be evaluated in a shell, so you can do stuff like `$(echo "foo")`.
   * @default {}
   */
  readonly env?: { [name: string]: string };

  /**
   * A shell command which determines if the this task should be executed. If
   * the program exits with a zero exit code, steps will be executed. A non-zero
   * code means that task will be skipped.
   */
  readonly condition?: string;
}

export interface TaskOptions extends TaskCommonOptions {
  /**
   * Shell command to execute as the first command of the task.
   * @default - add steps using `task.exec(command)` or `task.spawn(subtask)`
   */
  readonly exec?: string;
}

/**
 * A task that can be performed on the project. Modeled as a series of shell
 * commands and subtasks.
 */
export class Task {
  /**
   * Task name.
   */
  public readonly name: string;

  /**
   * The description of the task.
   */
  public readonly description?: string;

  /**
   * The start menu category of the task.
   */
  public readonly category?: TaskCategory;

  /**
   * A command to execute which determines if the task should be skipped. If it
   * returns a zero exit code, the task will not be executed.
   */
  public readonly condition?: string;

  private readonly _steps: TaskStep[];
  private readonly _env: { [name: string]: string };
  private readonly tasks: Tasks;

  constructor(tasks: Tasks, name: string, props: TaskOptions = { }) {
    this.tasks = tasks;
    this.name = name;
    this.description = props.description;
    this.category = props.category;
    this.condition = props.condition;

    this._env = props.env ?? {};
    this._steps = [];

    if (props.exec) {
      this.exec(props.exec);
    }
  }

  /**
   * Reset the task so it no longer has any commands.
   * @param command the first command to add to the task after it was cleared.
  */
  public reset(command?: string) {
    while (this._steps.length) {
      this._steps.shift();
    }

    if (command) {
      this.exec(command);
    }
  }

  /**
   * Executes a shell command
   * @param command Shell command
   */
  public exec(command: string, options: TaskStepOptions = { }) {
    this._steps.push({ exec: command, ...options });
  }

  /**
   * Adds a command at the beginning of the task.
   * @param shell The command to add.
   */
  public prepend(shell: string, options: TaskStepOptions = {}) {
    this._steps.unshift({
      exec: shell,
      ...options,
    });
  }

  /**
   * Spawns a sub-task.
   * @param subtask The subtask to execute.
   */
  public execTask(subtask: Task, options: TaskStepOptions = {}) {
    this._steps.push({ execTask: subtask.name, ...options });
  }

  /**
   * Adds an environment variable to this task.
   * @param name The name of the variable
   * @param value The value. If the value is surrounded by `$()`, we will
   * evaluate it within a subshell and use the result as the value of the
   * environment variable.
   */
  public env(name: string, value: string) {
    this._env[name] = value;
  }

  /**
   * Commits pending changes to the local git repository.
   *
   * @param message The commit message
   * @param options Commit options
   */
  public commit(message: string, options: CommitOptions) {
    const commands = new Array<string>();

    if (options.username) {
      commands.push(`git config user.name "${options.username}"`);
    }

    if (options.email) {
      commands.push(`git config user.email "${options.email}"`);
    }

    const add = (options.add ?? true) ? '-a' : '';
    commands.push(`git commit ${add} -m "${message}"`);

    this.exec(commands.join(' && '), options);
  }

  public push(branch: string, options: PushOptions) {
    task.exec('git push --follow-tags origin $BRANCH', {
      name: 'Push changes',
      env: {
      },
    });
  }

  /**
   * Defines a task output artifact.
   * @param directory The directory with the output.
   */
  public artifact(directory: string): TaskArtifact {
    return new TaskArtifact(this, directory);
  }

  /**
   * Returns an immutable copy of all the step specifications of the task.
   */
  public get steps() {
    return [...this._steps];
  }

  /**
   * Renders this task as a single shell command.
   */
  public toShellCommand(): string {
    const cmd = new Array<string>();

    for (const step of this.steps) {
      if (step.name) {
        cmd.push(`echo ${step.name}`);
      }
      if (step.exec) {
        cmd.push(step.exec);
      }
      if (step.execTask) {
        const subtask = this.tasks.tryFind(step.execTask);
        if (!subtask) {
          throw new Error(`unable to resolve subtask ${step.execTask}`);
        }

        cmd.push(`( ${subtask.toShellCommand()} )`);
      }
    }

    const allCommands = cmd.map(c => `( ${c} )`).join(' && ');
    const withCondition = this.condition ? `! ( ${this.condition} ) || ( ${allCommands} )` : allCommands;

    const env = {
      ...this.tasks.env,
      ...this._env,
    };

    const lines = new Array<string>();
    for (const [k, v] of Object.entries(env)) {
      lines.push(`${k}="${v}"; `);
    }

    return `( ${lines.join('')} ${withCondition} )`;
  }

  /**
   * Renders a task spec into the manifest.
   *
   * @internal
   */
  public _renderSpec(): TaskSpec {
    return {
      name: this.name,
      category: this.category,
      description: this.description,
      env: this._env,
      steps: this._steps,
      condition: this.condition,
    };
  }
}

export enum TaskCategory {
  BUILD = '00.build',
  TEST = '10.test',
  RELEASE = '20.release',
  MAINTAIN = '30.maintain',
  MISC = '99.misc',
}

export class TaskArtifact {
  public readonly directory: string;
  public readonly task: Task;

  constructor(task: Task, directory: string) {
    this.task = task;
    this.directory = directory;
  }
}

export interface CommitOptions extends TaskStepOptions {
  /**
   * The commit user name.
   */
  readonly username?: string;

  /**
   * The commit user email.
   */
  readonly email?: string;

  /**
   * Add all pending changes to the commit.
   * @default - true
   */
  readonly add?: boolean;
}

export interface PushOptions extends TaskStepOptions {
  /**
   * Push git tags.
   * @default true
   */
  readonly tags?: boolean;


}