import { compare, hash } from "bcrypt";
import { AppError } from "../errors/app-error";
import {
  ConflictError,
  InvalidRequestError,
  UnauthorizedError,
} from "../errors/custom-errors";
import env from "../env";
import { createToken } from "../utils/auth";
import type { TComms } from "./backend-comms";
import db from "@repo/db";
import { users } from "@repo/db/schema";

export const createAuthService = ({
  sendToEngine,
}: {
  sendToEngine: TComms["sendToEngineStream"];
}) => {
  const signup = async (username: string, password: string, name: string) => {
    try {
      const user = await db.query.users.findFirst({
        columns: {
          id: true,
        },
        where: (users, { eq }) => eq(users.username, username),
      });
      if (user) {
        throw new ConflictError();
      }

      const hashedPassword = await hash(password, env.SALT_ROUNDS);

      const newUser = await db
        .insert(users)
        .values({
          username,
          passwordHash: hashedPassword,
          name,
        })
        .returning()
        .then((res) => res[0]!);

      /**
       * Fire-and-forget, and it MUST stay unable to crash the process.
       *
       * Signing up should not fail because the engine is slow: every engine
       * handler lazily creates a missing user anyway, so a dropped
       * `init_balance` costs nothing but a zero balance appearing on first
       * read. But this call is deliberately not awaited, and since the engine
       * transport gained a timeout it can now REJECT — an unhandled rejection
       * takes the whole API down with it. That is not hypothetical: it killed
       * the backend during manual testing, turning a slow engine into a total
       * outage minutes after an unrelated signup.
       *
       * Any other unawaited `sendToEngine` call needs the same treatment.
       */
      void sendToEngine("init_balance", {
        userId: newUser.id,
      }).catch((err: unknown) => {
        console.error(
          "init_balance failed for",
          newUser.id,
          err instanceof Error ? err.message : err,
        );
      });

      return {
        token: createToken({ userId: newUser.id }),
        userId: newUser.id,
      };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      console.log(err);

      throw new InvalidRequestError();
    }
  };

  const signin = async (username: string, password: string) => {
    try {
      const user = await db.query.users.findFirst({
        columns: {
          id: true,
          passwordHash: true,
        },
        where: (users, { eq }) => eq(users.username, username),
      });
      if (!user) {
        throw new InvalidRequestError("Invalid Credentials");
      }

      const matches = await compare(password, user.passwordHash);
      if (!matches) {
        throw new InvalidRequestError("Invalid Credentials");
      }

      return {
        token: createToken({ userId: user.id }),
        userId: user.id,
      };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }

      throw new InvalidRequestError();
    }
  };

  /**
   * The signed-in user's own record. Used by `GET /me`, which exists because
   * the client cannot read its own httpOnly cookie to find out who it is.
   */
  const getUserById = async (userId: string) => {
    const user = await db.query.users.findFirst({
      columns: { id: true, username: true, name: true },
      where: (users, { eq }) => eq(users.id, userId),
    });
    if (!user) {
      // A valid token for a user that no longer exists: treat as unauthorised
      // so the client clears the session rather than retrying forever.
      throw new UnauthorizedError(
        "Session is no longer valid",
        "TOKEN_INVALID",
      );
    }
    return user;
  };

  return { signup, signin, getUserById };
};
