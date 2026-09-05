import { defineMiddleware } from "astro:middleware";
import { auth } from "./lib/auth.ts";

export const onRequest = defineMiddleware(async (context, next) => {
  const result = await auth.api.getSession({ headers: context.request.headers });

  if (result) {
    context.locals.user = result.user;
    context.locals.session = result.session;
  } else {
    context.locals.user = null;
    context.locals.session = null;
  }

  return next();
});
