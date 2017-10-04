const moo = require('moo');
const fs = require('fs');
const path = require('path');
const Promise = require('bluebird');

let lexer = moo.compile({
  space: {match: /\s+/, lineBreaks: true},
  comment: /\/\/.*?$/,
  functionStart:  '(',
  functionEnd:  ')',
  concat: ',',
  newlist: ';',
  push: '<',
  pop: '>',
  set: '!',
  get: '.',
  compose: '*',
  catch: '~',
  map: '^',
  reduce: '/',
  evaluate: '|',
  void: 'void',
  input: '$',
  scope: '#',
  load: '@',
  bool: /true|false/,
  symbol: /[A-Za-z_][A-Za-z0-9_]*/,
  clear: '-',
  float: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)(?:[eE][-+]?[0-9]+)?\b/,
  int: /-?(?:[0-9]|[1-9][0-9]+)\b/,
  string: /"(?:\\["bfnrt\/\\]|\\u[a-fA-F0-9]{4}|[^"\\])*"/
});

const modules = {};

exports.run = (mainPath) => {
  const filename = path.resolve(mainPath);

  const makef = parse(filename);

  makef(rootScope).then(evaluate);
};

const parse = function(filename) {
  if (modules[filename]) {
    return modules[filename];
  }

  const source = fs.readFileSync(filename).toString('utf8');
  lexer.reset(source);

  return modules[filename] = makeFunction(lexer, filename);
};

// https://stackoverflow.com/questions/24660096/correct-way-to-write-loops-for-promise
const promiseLoop = Promise.method((condition, action, value) => {
  if (!condition(value)){
    return value;
  }

  return action(value).then((value) => promiseLoop(condition, action, value));
});

const evaluate = function(f, x) {
  if (typeof f === 'function') {
    if (f.tailCall) {
      //console.log("tail call:");
      //let numCalls = 0;
      return f(x).then(f => promiseLoop(
          f => (f.tailCall),
          f => f(),
          f
        ))
        .then(f => {
          if (typeof f === 'function') {
            return f();
          }else{
            return f;
          }
        });

    }else{
      return f(x);
    }
  }else{
    return Promise.resolve(f);
  }
};


const ops = {
  clear: (token) => (stack) => {
    stack.pop();
    return stack;
  },
  bool: (token) => (stack) => {
    //console.log("bool");
    if (token.value === 'true'){
      stack.push(Promise.resolve(true));
    }else{
      stack.push(Promise.resolve(false));
    }

    return stack;
  },
  string: (token) => (stack) => {
    //console.log("string");
    stack.push(Promise.resolve(token.value.substring(1,token.value.length-1)));

    return stack;
  },
  symbol: (token) => (stack) => {
    //console.log("symbol");

    stack.push(Promise.resolve(token.value));

    return stack;
  },
  float: (token) => (stack) => {
    //console.log("float");
    stack.push(Promise.resolve(parseFloat(token.value)));

    return stack;
  },
  int: (token) => (stack) => {
    //console.log("int");
    stack.push(Promise.resolve(parseInt(token.value)));

    return stack;
  },
  void: (token) => (stack) => {
    //console.log("void");

    stack.push(Promise.resolve({}));
    return stack;
  },
  input: (token) => (stack, scope) => {
    //console.log("input");
    stack.push(Promise.resolve(scope.input));

    return stack;
  },
  scope: (token) => (stack, scope) => {
    //console.log("scope");
    stack.push(Promise.resolve(scope.get));

    return stack;
  },
  load: (token) => (stack, scope) => {
    stack.push(Promise.resolve(moduleName => {
      const moduleFilename = path.resolve(scope.dirname(), moduleName);

      const makef = parse(moduleFilename);

      return makef(rootScope);
    }));

    return stack;
  },
  set: (token) => (stack) => {
    //console.log("reference");
    const value = stack.pop();
    const key = stack.pop();
    const object = stack.pop();

    stack.push(
      Promise.all([value, key, object])
      .then(([value, key, object]) => {
        return Object.assign({}, object, {[key]: value});
      })
    );

    return stack;
  },
  get: (token, filename) => (stack) => {
    //console.log("dereference");
    const key = stack.pop();
    const object = stack.pop();

    stack.push(
      Promise.all([key, object])
      .then(([key, object]) => {

        if (typeof object === 'function') {
          return object(key)
        }else{
          return object[key];
        }

      })
      .catch(error => {
        throw new Error(error.message + ` (${filename}:${token.line}:${token.col})`);
      })
    );

    return stack;
  },
  compose: (token) => (stack) => {
    //console.log("compose");
    const f = stack.pop();
    const g = stack.pop();

    stack.push(
      Promise.all([f, g])
      .then(([f, g]) => {
        const h = (x) => {
          if (typeof g === 'function') {
            return evaluate(g, x)
            .then(gval => {
              if (f instanceof Array) {
                return f[gval];
              }else if (typeof f === 'function') {
                return f(gval);
              }else{
                throw new Error(`Not a function line ${token.line} col ${token.col}`);
              }
            });
          }else{
            return Promise.resolve().then(() => {
              if (f instanceof Array) {
                return f[g];
              }else if (typeof f === 'function') {
                return f(g);
              }else{
                throw new Error(`Not a function line ${token.line} col ${token.col}`);
              }
            });
          }
        };

        h.tailCall = f.tailCall;

        return h;
      })
    );

    return stack;
  },
  evaluate: (token) => (stack) => {
    //console.log("evaluate");
    const f = stack.pop();

    stack.push(f.then(evaluate));

    return stack;
  },
  catch: (token) => (stack) => {
    //console.log("evaluate");
    const f = stack.pop();
    const g = stack.pop();

    stack.push(
      Promise.all([f, g])
      .then(([f, g]) => {
        const h = (x) => {
          if (typeof g === 'function') {
            return evaluate(g, x).catch(error => evaluate(f, error));
          }else{
            return Promise.resolve(g);
          }
        };

        return h;
      })
    );

    return stack;
  },
  map: (token) => (stack) => {
    //console.log("map");
    const f = stack.pop();
    const arr = stack.pop();

    stack.push(
      Promise.all([f, arr])
      .then(([f, arr]) => {
        return Promise.all(arr.map((x, index) => evaluate(f, {x, index})));
      })
    );

    return stack;
  },
  reduce: (token) => (stack) => {
    //console.log("reduce");
    const f = stack.pop();
    const arr = stack.pop();

    stack.push(
      Promise.all([f, arr])
      .then(([f, arr]) => {
        return (initial) => {
          if (arr instanceof Array) {
            return arr.reduce((acc, x, index) => {
              if (acc) {
                return acc.then(acc => evaluate(f, {acc, x, index}));
              }else{
                return evaluate(f, {acc, x, index});
              }
            }, initial);
          }else if (typeof arr === 'function') {

            const reduce = (index, acc) => {
              return Promise.all([acc, evaluate(arr, {index})]).then(([acc, value]) => {

                if (typeof value === 'undefined'){
                  return acc;
                }

                return reduce(index + 1, evaluate(f, {acc, value, index}));
              });
            };

            return reduce(0, initial);

          }
        };
      })
    );

    return stack;
  },
  concat: (token) => (stack) => {
    //console.log("concat");

    const listEnd = stack.pop();
    const listStart = stack.pop();

    stack.push(
      Promise.all([listEnd, listStart])
      .then(([listEnd, listStart]) => {
        if (listEnd instanceof Array && listStart instanceof Array) {
          return [...listStart, ...listEnd];
        }else if (typeof listEnd === 'string' && typeof listStart === 'string') {
          return listStart + listEnd;
        }
      })
    );

    return stack;
  },
  push: (token) => (stack) => {
    //console.log("push");

    const value = stack.pop();
    const list = stack.pop();

    stack.push(
      Promise.all([value, list])
      .then(([value, list]) => {
        return [...list, value];
      })
    );

    return stack;
  },
  pop: (token) => (stack) => {
    //console.log("pop");

    const list = stack.pop();

    stack.push(list.then(list => {
      if (list.length > 1){
        return list.slice(0, listval.length-1);
      }else if (list.length === 1){
        return [];
      }else{
        throw new Error(`Cannot pop from empty list ${token.line} col ${token.col}`);
      }
    }));

    stack.push(list.then(list => {
      if (list.length > 1) {
        return list[list.length-1];
      }else if (list.length === 1){
        return list[0];
      }else{
        throw new Error(`Cannot pop from empty list  (${filename}:${token.line}:${token.col})`);
      }
    }));

    return stack;
  },
  newlist: (token, filename) => (stack) => {
    try{
      const f = stack.pop();
      stack.push(f.then(f => [f]));
    }catch(error) {
      throw new Error(error.message + ` (${filename}:${token.line}:${token.col})`)
    }

    return stack;
  }
};

const makeFunction = (lexer, filename) => {
  //console.log("function");
  const sequence = [];
  let tailCall = false;

  let token = lexer.next();
  let lastOp;

  while(token && token.type !== 'functionEnd'){

    if (token.type === 'functionStart'){
      sequence.push((makef => (stack, scope) => stack.push(makef(scope)))(makeFunction(lexer, filename)));
    }else{

      let op = ops[token.type];

      if (op) {
        lastOp = token.type;
        //console.log(`${sequence.length}: ${token.type}`);
        sequence.push(op(token, filename));
      }
    }

    token = lexer.next();
  }

  if (lastOp === "evaluate"){
    sequence.pop();
    tailCall = true;
  }

  return (scope) => {
    const f = (x) => {
      //console.log(`calling function: ${sequence.length}`);

      let localStack = [];
      const localScope = makeScope(scope, filename, x);

      sequence.forEach(op => {
        op(localStack, localScope);
      });

      if (localStack.length) {
        return localStack.pop();
      }
    };

    f.tailCall = tailCall;

    return Promise.resolve(f);
  };
};

const makeScope = (parentScope, filename, inputObj) => {

  const scope = {
    filename: () => (filename ? filename : parentScope.filename()),
    dirname: () => (filename ? path.dirname(filename) : parentScope.dirname()),
    input: inputObj,
    get: (key, includeLocalInput) => {
      //console.log(references);
      if (includeLocalInput && typeof inputObj !== 'undefined' && typeof inputObj[key] !== 'undefined') {
        return inputObj[key];
      }else{
        if (parentScope) {
          return parentScope.get(key, true);

        }else{
          throw new Error(`Key ${key} is not defined within scope.`)
        }
      }
    }
  };

  return scope;
};

const rootInput = {};

rootInput.print = console.log;

rootInput.eq = Promise.method((x) => (x[0] == x[1]));

rootInput.not = Promise.method((x) => {
  if (x instanceof Array) {
    return x.map((cur) => (!cur));
  }else{
    return !x;
  }
});

rootInput.or = Promise.method((x) => {
  return x.reduce((sum, cur) => (sum || cur), false);
});

rootInput.and = Promise.method((x) => {
  return x.reduce((sum, cur) => (sum && cur), true);
});

rootInput.xor = Promise.method((x) => {
  return x.reduce((sum, cur) => ((sum || cur) && !(sum && cur)), false);
});

rootInput.diff = Promise.method((x) => {
  if (typeof x === 'undefined'){
    throw new Error("diff must have an input.")
  }

  if (x instanceof Array) {
    if(x.length === 1) {
      return -x[0];
    }else if (x.length === 2) {
      return x[0] - x[1];
    }else{
      throw new Error("diff may only have 1 or 2 inputs.")
    }
  }else{
    return -x;
  }
});

rootInput.sum = Promise.method((x) => {
  return x.reduce((sum, cur) => (sum + cur), 0);
});

rootInput.prod = Promise.method((x) => {
  return x.reduce((sum, cur) => (sum * cur), 1);
});

rootInput.pow = Promise.method((x) => {
  if (typeof x === 'undefined'){
    throw new Error("pow must have an input.")
  }

  if (x instanceof Array) {
    if(x.length === 1) {
      return x[0];
    }else if (x.length === 2) {
      return Math.pow(x[0], x[1]);
    }else{
      throw new Error("pow may only have 1 or 2 inputs.")
    }
  }else{
    return x;
  }
});

const rootScope = makeScope(null, null, rootInput);
