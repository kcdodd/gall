const moo = require('moo');
const fs = require('fs');


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
  reference: ':',
  dereference: '.',
  compose: '*',
  evaluate: '|',
  void: 'void',
  bool: /true|false/,
  symbol: /[A-Za-z_][A-Za-z0-9_]*/,
  import: '#'
});

exports.parse = function(source) {
  lexer.reset(source);

  return exports.makeFunction(lexer);
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

exports.evaluate = evaluate;

exports.ops = {
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
  reference: (token) => (stack, scope) => {
    //console.log("reference");
    const keys = stack.pop();
    const value = stack.pop();

    if (typeof keys === "function") {
      scope.set(evaluate(keys), value);
    }else{
      scope.set(keys, value);
    }

    stack.push(value);
    return stack;
  },
  dereference: (token) => (stack, scope) => {
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
        throw new Error(`Not a function line ${token.line} col ${token.col}`)
      }
    };

    h.tailCall = f.tailCall;

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
      return [...a, ...b];
    });

    return stack;
  },
  newlist: (token) => (stack) => {
    const f = stack.pop();
    stack.push(() => ([evaluate(f)]));
    return stack;
  },
  import: (token) => (stack) => {
    const moduleName = stack.pop();
    const source = fs.readFileSync(evaluate(moduleName)).toString('utf8');
    const makef = exports.parse(source);

    makef(stack, rootScope);

    return stack;
  }
};

exports.makeFunction = (lexer) => {
  //console.log("function");
  const sequence = [];
  let tailCall = false;

  let token = lexer.next();
  let lastOp;

  while(token && token.type !== 'functionEnd'){

    if (token.type === 'functionStart'){
      sequence.push(exports.makeFunction(lexer));
    }else{

      let op = exports.ops[token.type];

      if (op) {
        lastOp = token.type;
        //console.log(`${sequence.length}: ${token.type}`);
        sequence.push(op(token));
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

      let localScope = exports.makeScope(scope);

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

exports.makeScope = (parentScope) => {
  const references = {};

  return {
    set: (key, value) => {

      if (typeof references[key] !== 'undefined') {
        throw new Error(`Value for key ${key} already defined`);
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

exports.run = (path) => {
  const source = fs.readFileSync(path).toString('utf8');
  const makef = exports.parse(source);
  const stack = [];
  makef(stack, rootScope);
  evaluate(stack.pop());
};

const rootScope = exports.makeScope();

rootScope.set("print", console.log);

rootScope.set("eq", (x) => (x[0] == x[1]));

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
