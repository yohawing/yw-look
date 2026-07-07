export function readValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export function readRepeatedOption(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}

export function hasFlag(args, name) {
  return args.includes(name);
}

export function parseNamedArgs(
  tokens,
  {
    values = {},
    flags = {
      "--help": "help",
      "-h": "help",
    },
    unknownMessage = (token) => `unknown argument: ${token}`,
    requireValues = true,
  } = {},
) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (Object.hasOwn(flags, token)) {
      parsed[flags[token]] = true;
    } else if (Object.hasOwn(values, token)) {
      parsed[values[token]] = requireValues
        ? readValue(tokens, ++index, token)
        : tokens[++index];
    } else {
      throw new Error(unknownMessage(token));
    }
  }
  return parsed;
}
