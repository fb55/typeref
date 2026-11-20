/** abc */
const abc = 123;
/** export abc */
export { abc, abc as abcRef };

/** foo */
namespace foo {
  export const abc = 123;
}
/** export foo */
export { foo };

const bare = 1;
/** export bare */
export { bare };

/** A override */
export * as A from "./module-comment.ts";
export * as B from "./package-documentation.ts";
