export interface Contract {
  optional?: boolean;
}

export declare class Service implements Contract {}
export interface Service extends Contract {}

export declare class Child extends Service {}
