const moo = require('moo');

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
  access: '@',
  void: 'void',
  bool: /true|false/,
  symbol: /[A-Za-z_][A-Za-z0-9_]*/
});

exports.parse = function(source) {
  lexer.reset(source);

  return exports.makeFunction(lexer);
};

const evaluate = function(f, x) {
  if (typeof f === 'function') {
    if (f.tailCall) {
      //console.log("tail call");
      let nextF = f(x);
      while(nextF.tailCall) {
        nextF = nextF();
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
  bool: (value) => (stack) => {
    //console.log("bool");
    stack.push(() => {
      if (value === 'true'){
        return true;
      }else{
        return false;
      }
    });
    return stack;
  },
  string: (value) => (stack) => {
    //console.log("string");
    stack.push(() => (value.substring(1,value.length-1)));
    return stack;
  },
  float: (value) => (stack) => {
    //console.log("float");
    stack.push(() => (parseFloat(value)));
    return stack;
  },
  int: (value) => (stack) => {
    //console.log("int");
    stack.push(() => (parseInt(value)));
    return stack;
  },
  symbol: (value) => (stack, scope) => {
    //console.log("symbol");
    stack.push(() => (value));
    return stack;
  },
  reference: () => (stack, scope) => {
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
  dereference: () => (stack, scope) => {
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
  compose: () => (stack) => {
    //console.log("compose");
    const f = stack.pop();
    const g = stack.pop();

    stack.push(() => {
      if (typeof g === 'function'){
        return evaluate(f, evaluate(g));
      }else{
        return evaluate(f, g);
      }
    });

    return stack;
  },
  evaluate: () => (stack) => {
    //console.log("evaluate");
    const f = stack.pop();

    stack.push(evaluate(f));

    return stack;
  },
  concat: () => (stack) => {
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
  newlist: () => (stack) => {
    const f = stack.pop();
    stack.push(() => ([evaluate(f)]));
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
    //console.log(token);

    if (token.type === 'functionStart'){
      sequence.push(exports.makeFunction(lexer));
    }else{

      let op = exports.ops[token.type];

      if (op) {
        lastOp = token.type;
        //console.log(`${sequence.length}: ${token.type}`);
        sequence.push(op(token.value));
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
