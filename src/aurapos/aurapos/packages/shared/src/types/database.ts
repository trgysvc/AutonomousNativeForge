export interface Business {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Branch {
  id: string;
  businessId: string;
  name: string;
  address: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Staff {
  id: string;
  branchId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Order {
  id: string;
  branchId: string;
  staffId: string;
  customerName: string | null;
  totalAmount: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}