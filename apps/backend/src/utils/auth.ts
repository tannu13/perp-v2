import * as jwt from "jsonwebtoken";
import env from "../env";

type TTokenPayload = {
  userId: string;
};
export const createToken = (payload: TTokenPayload) => {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

export const decodeToken = (token: string) => {
  return jwt.verify(token, env.JWT_SECRET) as TTokenPayload;
};
