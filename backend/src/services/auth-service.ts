import { compare, hash } from "bcrypt";
import db from "../db/connection";
import { AppError } from "../errors/app-error";
import { ConflictError, InvalidRequestError } from "../errors/custom-errors";
import env from "../env";
import { users } from "../db/schema";
import { createToken } from "../utils/auth";

export const createAuthService = () => {
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

      return {
        token: createToken({ userId: newUser.id }),
        userId: newUser.id,
      };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }

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

  return { signup, signin };
};
