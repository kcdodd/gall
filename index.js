const gall = require('./src/gall');
const fs = require('fs');

let source = fs.readFileSync('./src/example.gall').toString('utf8');

const rootScope = gall.makeScope();

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

const makef = gall.parse(source);
const stack = [];
makef(stack, rootScope);
gall.evaluate(stack.pop());
