const moo = require('moo');
const fs = require('fs');
const path = require('path');

let lexer = moo.compile({
  space: {match: /\s+/, lineBreaks: true},
  comment: /\/\/.*?$/,
  float: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)(?:[eE][-+]?[0-9]+)?\b/,
  int: /-?(?:[0-9]|[1-9][0-9]+)\b/,
  string: /"(?:\\["bfnrt\/\\]|\\u[a-fA-F0-9]{4}|[^"\\])*"/,
  functionStart:  '(',
  functionEnd:  ')',
  concat: ',',
  newlist: ';',
  push: '<',
  pop: '>',
  set: ':',
  reset: '!',
  get: '.',
  compose: '*',
  map: '^',
  reduce: '/',
  evaluate: '|',
  void: 'void',
  bool: /true|false/,
  symbol: /[A-Za-z_][A-Za-z0-9_]*/,
  import: '#'
});

const modules = {};

exports.run = (mainPath) => {
  const filename = path.resolve(mainPath);

  const makef = parse(filename);
  const stack = [];
  makef(stack, rootScope);
  evaluate(stack.pop());
};

const parse = function(filename) {
  if (modules[filename]) {
    return modules[filename];
  }

  const source = fs.readFileSync(filename).toString('utf8');
  lexer.reset(source);

  return modules[filename] = makeFunction(lexer, filename);
};

const evaluate = function(f, x) {
  if (typeof f === 'function') {
    if (f.tailCall) {
      //console.log("tail call:");
      //let numCalls = 0;

      let nextF = f(x);

      while(nextF.tailCall) {
        nextF = nextF();
        //console.log('iteration: ' + numCalls);
        //numCalls++;
      }

      if (typeof nextF === 'function') {
        return nextF();
      }else{
        return nextF;
      }

    }else{
      return f(x);
    }
  }else{
    return f;
  }
};


const ops = {
  bool: (token) => (stack) => {
    //console.log("bool");
    stack.push(() => {
      if (token.value === 'true'){
        return true;
      }else{
        return false;
      }
    });
    return stack;
  },
  string: (token) => (stack) => {
    //console.log("string");
    stack.push(() => (token.value.substring(1,token.value.length-1)));
    return stack;
  },
  float: (token) => (stack) => {
    //console.log("float");
    stack.push(() => (parseFloat(token.value)));
    return stack;
  },
  int: (token) => (stack) => {
    //console.log("int");
    stack.push(() => (parseInt(token.value)));
    return stack;
  },
  void: (token) => (stack) => {
    //console.log("void");
    stack.push(() => ([]));
    return stack;
  },
  symbol: (token) => (stack, scope) => {
    //console.log("symbol");
    stack.push(() => (token.value));
    return stack;
  },
  set: (token) => (stack, scope) => {
    //console.log("reference");
    const keys = stack.pop();
    const value = stack.pop();

    if (typeof keys === "function") {
      scope.set(evaluate(keys), value);
    }else{
      scope.set(keys, value);
    }

    return stack;
  },
  reset: (token) => (stack, scope) => {
    //console.log("redefine");
    const keys = stack.pop();
    const value = stack.pop();

    if (typeof keys === "function") {
      scope.reset(evaluate(keys), value);
    }else{
      scope.reset(keys, value);
    }

    return stack;
  },
  get: (token) => (stack, scope) => {
    //console.log("dereference");
    const keys = stack.pop();

    if (typeof keys === "function") {
      const keyval = evaluate(keys);
      const refval = scope.get(keyval);
      //console.log(keyval + " -> " + refval);
      stack.push(refval);
    }else{
      const refval = scope.get(keys);
      //console.log(keys + " -> " + refval);
      stack.push(refval);
    }
    return stack;
  },
  compose: (token) => (stack) => {
    //console.log("compose");
    const f = stack.pop();
    const g = stack.pop();

    const h = (x) => {
      const gval = (typeof g === 'function') ? evaluate(g, x) : g;

      if (f instanceof Array) {
        return f[gval];
      }else if (typeof f === 'function') {
        return f(gval);
      }else{
        throw new Error(`Not a function line ${token.line} col ${token.col}`);
      }
    };

    h.tailCall = f.tailCall;

    stack.push(h);

    return stack;
  },
  map: (token) => (stack) => {
    //console.log("compose");
    const f = stack.pop();
    const arr = stack.pop();

    const newarr = () => {
      const arrval = (typeof arr === 'function') ? evaluate(arr) : arr;

      return arrval.map((x, index) => evaluate(f, [x, index]));
    };

    stack.push(newarr);

    return stack;
  },
  reduce: (token) => (stack) => {
    //console.log("compose");
    const f = stack.pop();
    const arr = stack.pop();

    const h = (initial) => {
      const arrval = (typeof arr === 'function') ? evaluate(arr) : arr;

      return arrval.reduce((acc, x, index) => evaluate(f, [acc, x, index]), initial);
    };

    stack.push(h);

    return stack;
  },
  evaluate: (token) => (stack) => {
    //console.log("evaluate");
    const f = stack.pop();

    stack.push(evaluate(f));

    return stack;
  },
  concat: (token) => (stack) => {
    //console.log("concat");

    const listEnd = stack.pop();
    const listStart = stack.pop();
    stack.push(() => {
      const a = evaluate(listStart);
      const b = evaluate(listEnd);

      if (a instanceof Array && b instanceof Array) {
        return [...a, ...b];
      }else if (typeof a === 'string' && typeof b === 'string') {
        return a + b;
      }
    });

    return stack;
  },
  push: (token) => (stack) => {
    //console.log("push");

    const value = stack.pop();
    const list = stack.pop();
    stack.push(() => {
      const valueval = evaluate(value);
      const listval = evaluate(list);
      return [...listval, valueval];
    });

    return stack;
  },
  pop: (token) => (stack) => {
    //console.log("pop");

    const list = stack.pop();
    const listval = evaluate(list);

    if (listval.length > 1) {

      stack.push(listval.slice(0, listval.length-1));
      stack.push(listval[listval.length-1]);

    }else if (listval.length === 1){
      stack.push([]);
      stack.push(listval[0]);
    }else{
      throw new Error(`Cannot pop from empty list ${token.line} col ${token.col}`);
    }

    return stack;
  },
  newlist: (token) => (stack) => {
    const f = stack.pop();
    stack.push(() => ([evaluate(f)]));
    return stack;
  },
  import: (token, filename) => (stack, scope) => {
    const moduleName = stack.pop();
    const moduleFilename = path.resolve(path.dirname(filename), evaluate(moduleName));

    const makef = parse(moduleFilename);

    makef(stack, rootScope);

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
      sequence.push(makeFunction(lexer, filename));
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

  return (stack, scope) => {
    const f = (x) => {
      //console.log(`calling function: ${sequence.length}`);

      let localStack = [];
      if (typeof x !== 'undefined') {
        localStack.push(x);
      }

      let localScope = makeScope(scope);

      sequence.forEach(op => {
        op(localStack, localScope);
      });

      if (localStack.length) {
        return localStack.pop();
      }
    };

    f.tailCall = tailCall;

    stack.push(f);

    return stack;
  };
};

const makeScope = (parentScope, filename) => {
  const references = {};

  return {
    filename: () => (filename ? filename : parentScope.filename()),
    dirname: () => (filename ? path.dirname(filename) : parentScope.dirname()),
    set: (key, value) => {

      if (typeof references[key] !== 'undefined') {
        throw new Error(`Value for key ${key} already defined`);
      }else{

        references[key] = value;
      }
      //console.log(references);
    },
    reset: (key, value) => {
      if (typeof references[key] === 'undefined') {
        parentScope.reset(key, value);
      }else{
        references[key] = value;
      }
      //console.log(references);
    },
    get: (key) => {
      //console.log(references);
      if (typeof references[key] === 'undefined') {
        if (parentScope) {
          return parentScope.get(key);
        }else{
          throw new Error(`Value for key ${key} not defined`);
        }
      }else{
        return references[key];
      }
    }
  };
};

const rootScope = makeScope();

rootScope.set("print", console.log);

rootScope.set("eq", (x) => (x[0] == x[1]));

rootScope.set("not", (x) => {
  if (x instanceof Array) {
    return x.map((cur) => (!cur));
  }else{
    return !x;
  }
});

rootScope.set("or", (x) => {
  return x.reduce((sum, cur) => (sum || cur), false);
});

rootScope.set("and", (x) => {
  return x.reduce((sum, cur) => (sum && cur), true);
});

rootScope.set("xor", (x) => {
  return x.reduce((sum, cur) => ((sum || cur) && !(sum && cur)), false);
});

rootScope.set("diff", (x) => {
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

rootScope.set("sum", (x) => {
  return x.reduce((sum, cur) => (sum + cur), 0);
});

rootScope.set("prod", (x) => {
  return x.reduce((sum, cur) => (sum * cur), 1);
});

rootScope.set("pow", (x) => {
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
